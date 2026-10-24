import { expect, test } from '@playwright/test';

const status = {
  ok: true,
  service: 'voice-mind-map',
  runtimeId: 'e2e',
  shutdownToken: 'e2e-token',
  ai: { ready: true, provider: 'ollama', model: 'qwen-q4kp' },
  transcription: {
    http: { ready: true, model: 'test-http' },
    realtime: { ready: true, model: 'test-stream' },
  },
};

const capture = {
  id: '11111111-1111-4111-8111-111111111111',
  source: 'file' as const,
  status: 'recognized' as const,
  transcript: '整理录音里的离线产品计划',
  recordingDir: 'outputs/e2e-capture',
  createdAt: '2026-07-21T12:00:00.000Z',
  updatedAt: '2026-07-21T12:00:00.000Z',
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/status', (route) => route.fulfill({ json: status }));
  await page.route('**/api/captures/pending', (route) => route.fulfill({ json: { captures: [] } }));
  await page.route('**/api/mind-map/change', async (route) => {
    const request = route.request().postDataJSON() as { input: string; document: unknown };
    const document = {
      schemaVersion: 2,
      revision: 1,
      title: '离线产品计划',
      root: {
        id: 'root-plan',
        title: '离线产品计划',
        content: request.input,
        kind: 'topic',
        status: 'open',
        source: 'user',
        children: [],
      },
      relations: [],
      groups: [],
    };
    await route.fulfill({
      json: {
        document,
        changeSet: {
          baseRevision: 0,
          summary: '建立离线产品计划',
          commands: [
            {
              type: 'replaceDocument',
              document: { ...document, schemaVersion: undefined, revision: undefined },
            },
          ],
        },
        appliedCommands: [
          {
            type: 'replaceDocument',
            document: { title: document.title, root: document.root, relations: [], groups: [] },
          },
        ],
        rejectedCommands: [],
      },
    });
  });
});

test('creates a blank workspace change, auto-applies it, and undoes it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: '待整理内容' }).fill('做一个离线优先的产品');
  await page.getByRole('button', { name: '整理⌘↵' }).click();
  await expect(page.getByRole('heading', { name: '离线产品计划', exact: true })).toBeVisible();
  await page.locator('summary').filter({ hasText: '本次变更' }).click();
  await expect(page.getByText('建立离线产品计划')).toBeVisible();
  await page.getByRole('button', { name: '撤销本次变更' }).click();
  await expect(page.getByText('开始整理你的想法')).toBeVisible();
});

test('restores the committed V2 workspace after a reload without restoring history', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: '待整理内容' }).fill('做一个离线优先的产品');
  await page.getByRole('button', { name: '整理⌘↵' }).click();
  await expect(page.getByRole('heading', { name: '离线产品计划', exact: true })).toBeVisible();

  await page.reload();

  await expect(page.getByRole('heading', { name: '离线产品计划', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '撤销' })).toBeDisabled();
});

test('imports a complete audio file, organizes it, and marks the capture complete', async ({
  page,
}) => {
  let markedOrganized = false;
  await page.route('**/api/transcription/file', (route) => route.fulfill({ json: { capture } }));
  await page.route(`**/api/captures/${capture.id}/organized`, (route) => {
    markedOrganized = true;
    return route.fulfill({
      json: { capture: { ...capture, status: 'organized', updatedAt: '2026-07-21T12:01:00.000Z' } },
    });
  });
  await page.goto('/');

  await page.locator('input[type="file"]').setInputFiles({
    name: 'idea.webm',
    mimeType: 'audio/webm',
    buffer: Buffer.alloc(1200, 1),
  });

  await expect(page.getByRole('heading', { name: '离线产品计划', exact: true })).toBeVisible();
  await expect.poll(() => markedOrganized).toBe(true);
});

test('records realtime PCM, archives the final transcript, and organizes it', async ({ page }) => {
  await page.addInitScript(() => {
    let offset = 0;
    const realNow = Date.now.bind(Date);
    Date.now = () => realNow() + offset;
    Object.defineProperty(window, '__advanceRecordingTime', {
      value: () => {
        offset += 4000;
      },
    });

    const fakeTrack = { stop() {} };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [fakeTrack] }) },
    });

    class FakeMediaRecorder {
      static isTypeSupported() {
        return true;
      }
      state = 'inactive';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob([new Uint8Array(1200)], { type: 'audio/webm' }) });
        this.onstop?.();
      }
    }
    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      value: FakeMediaRecorder,
    });

    class FakeAudioContext {
      sampleRate = 48_000;
      state = 'running';
      destination = {};
      createMediaStreamSource() {
        return { connect() {}, disconnect() {} };
      }
      createGain() {
        return { gain: { value: 1 }, connect() {}, disconnect() {} };
      }
      createScriptProcessor() {
        const processor = {
          onaudioprocess: null as
            ((event: { inputBuffer: { getChannelData(): Float32Array } }) => void) | null,
          connect() {
            window.setTimeout(
              () =>
                processor.onaudioprocess?.({
                  inputBuffer: { getChannelData: () => new Float32Array(4096).fill(0.1) },
                }),
              0,
            );
          },
          disconnect() {},
        };
        return processor;
      }
      async close() {
        this.state = 'closed';
      }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });
    Object.defineProperty(window, 'AudioWorkletNode', { configurable: true, value: undefined });

    class FakeWebSocket {
      static OPEN = 1;
      readyState = FakeWebSocket.OPEN;
      binaryType = '';
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      send(payload: string | ArrayBuffer) {
        if (typeof payload === 'string' && JSON.parse(payload).type === 'end') {
          window.setTimeout(
            () =>
              this.onmessage?.({
                data: JSON.stringify({
                  type: 'final',
                  text: '整理录音里的离线产品计划',
                  complete: true,
                }),
              }),
            0,
          );
        }
      }
      close() {
        this.readyState = 3;
      }
    }
    Object.defineProperty(window, 'WebSocket', { configurable: true, value: FakeWebSocket });
  });
  await page.route('**/api/transcription/archive', (route) =>
    route.fulfill({ json: { capture: { ...capture, source: 'realtime' } } }),
  );
  await page.route(`**/api/captures/${capture.id}/organized`, (route) =>
    route.fulfill({
      json: {
        capture: {
          ...capture,
          source: 'realtime',
          status: 'organized',
          updatedAt: '2026-07-21T12:01:00.000Z',
        },
      },
    }),
  );
  await page.goto('/');

  await page.getByRole('button', { name: '实时录音' }).click();
  await expect(page.getByText('正在录音')).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { __advanceRecordingTime: () => void }).__advanceRecordingTime(),
  );
  await page.getByRole('button', { name: '结束录音' }).click();

  await expect(page.getByRole('heading', { name: '离线产品计划', exact: true })).toBeVisible();
});

test('sends the current runtime token when shutting down', async ({ page }) => {
  let shutdownToken = '';
  await page.route('**/api/runtime/shutdown', (route) => {
    shutdownToken = route.request().headers()['x-local-shutdown-token'] ?? '';
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/');

  await page.getByRole('button', { name: '更多' }).click();
  await page.getByRole('menuitem', { name: '关闭本次运行' }).click();

  await expect.poll(() => shutdownToken).toBe('e2e-token');
});

test('keeps a large long-form map usable at 1440 by 900', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.unroute('**/api/mind-map/change');
  await page.route('**/api/mind-map/change', async (route) => {
    const children = Array.from({ length: 40 }, (_, index) => ({
      id: `node-${index}`,
      title: `计划节点 ${index + 1}`,
      content: '这是一段用于验证长文本节点布局、换行和大型画布性能的详细说明。'.repeat(3),
      kind: 'task' as const,
      status: 'open' as const,
      source: 'summary' as const,
      children: [],
    }));
    const document = {
      schemaVersion: 2 as const,
      revision: 1,
      title: '大型发布计划',
      root: {
        id: 'large-root',
        title: '大型发布计划',
        content: '覆盖大型导图和长文本视觉验收',
        kind: 'topic' as const,
        status: 'open' as const,
        source: 'user' as const,
        children,
      },
      relations: [],
      groups: [],
    };
    const replaceDocument = {
      title: document.title,
      root: document.root,
      relations: [],
      groups: [],
    };
    await route.fulfill({
      json: {
        document,
        changeSet: {
          baseRevision: 0,
          summary: '建立大型发布计划',
          commands: [{ type: 'replaceDocument', document: replaceDocument }],
        },
        appliedCommands: [{ type: 'replaceDocument', document: replaceDocument }],
        rejectedCommands: [],
      },
    });
  });
  await page.goto('/');
  await page
    .getByRole('textbox', { name: '待整理内容' })
    .fill('把这段很长的产品发布思路整理成覆盖四十个执行节点的大型计划。'.repeat(8));
  await page.getByRole('button', { name: '整理⌘↵' }).click();

  await expect(page.getByRole('heading', { name: '大型发布计划', exact: true })).toBeVisible();
  await expect(page.getByText('41 个节点', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '思路桌面' })).toBeVisible();
  await expect(page.locator('.desk-branch')).toHaveCount(40);
  await page.getByRole('button', { name: '导图', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(41);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('uses the narrow desktop layout below 840 pixels without horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 720 });
  await page.goto('/');

  await expect(page.getByRole('region', { name: '想法捕捉' })).toBeVisible();
  await expect(page.getByRole('button', { name: '更多' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
