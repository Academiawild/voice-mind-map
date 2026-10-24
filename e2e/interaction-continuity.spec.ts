import { expect, test, type Page } from '@playwright/test';

const thought = (id: string, title: string) => ({
  id,
  title,
  content: '把期待、代价和可以尝试的一小步分开看。',
  kind: 'question',
  status: 'open',
  source: 'user',
  children: [],
});
const document = {
  schemaVersion: 2,
  revision: 1,
  title: '很多事情，也能从容地想',
  root: {
    ...thought('root', '很多事情，也能从容地想'),
    kind: 'topic',
    children: Array.from({ length: 8 }, (_, branch) => ({
      ...thought(`topic-${branch}`, `主题 ${branch + 1}`),
      kind: 'topic',
      children: Array.from({ length: 19 }, (_, index) =>
        thought(`thought-${branch}-${index}`, `细想 ${branch + 1} · ${index + 1}`),
      ),
    })),
  },
  relations: Array.from({ length: 20 }, (_, index) => ({
    id: `relation-${index}`,
    sourceId: `thought-${index % 8}-${index % 19}`,
    targetId: `thought-${(index + 1) % 8}-${(index + 3) % 19}`,
    label: `联系 ${index + 1}：一个选择会改变另一个选择的可用时间`,
    dashed: true,
  })),
  groups: [],
};
const navigation = [0, 1, 2].map((index) => ({
  nodeId: `topic-${index}`,
  reason: `入口 ${index + 1} 有助于澄清其他选择。`,
  nextStep: `先写出主题 ${index + 1} 想改变的一件事。`,
}));

async function prepare(page: Page) {
  await page.addInitScript(
    ({ document, navigation }) => {
      localStorage.setItem(
        'voice-mind-map:workspace:v2',
        JSON.stringify({
          document,
          navigation,
          positions: {},
          viewport: { x: 120, y: 80, zoom: 0.5 },
          expandedInferenceNodeIds: [],
          savedInputs: [],
          draft: '',
        }),
      );
    },
    { document, navigation },
  );
  await page.route('**/api/status', (route) =>
    route.fulfill({
      json: {
        ok: true,
        service: 'voice-mind-map',
        runtimeId: 'continuity-test',
        shutdownToken: 'test',
        ai: { ready: true, provider: 'ollama', model: 'test' },
        transcription: {
          http: { ready: false, model: 'test' },
          realtime: { ready: false, model: 'test' },
        },
      },
    }),
  );
  await page.route('**/api/captures/pending', (route) => route.fulfill({ json: { captures: [] } }));
  await page.goto('/');
}

test('keeps reading context across search, view switches and repeated local decisions on 161 thoughts', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await prepare(page);
  const desk = page.getByRole('region', { name: '思路桌面' });
  const panel = page.getByRole('complementary', { name: '思考导航' });
  const input = page.getByRole('textbox', { name: '待整理内容' });
  await page.getByRole('button', { name: '切入点 2：主题 2' }).click();
  await input.fill('不管切到哪里，这个没写完的想法都要留着。');
  await desk.evaluate((element) => {
    element.scrollTop = 900;
    element.dispatchEvent(new Event('scroll'));
  });
  await panel.evaluate((element) => {
    element.scrollTop = 260;
    element.dispatchEvent(new Event('scroll'));
  });
  await page.getByRole('button', { name: '导图', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(161);
  await page.getByRole('button', { name: '显示连线说明', exact: true }).click();
  const viewport = page.locator('.react-flow__viewport');
  const beforeZoom = await viewport.getAttribute('style');
  await page.locator('.react-flow__pane').hover({ position: { x: 30, y: 80 } });
  await page.mouse.wheel(0, -220);
  await expect.poll(() => viewport.getAttribute('style')).not.toBe(beforeZoom);
  // Wait for onMoveEnd to persist the final viewport, not an animation frame.
  await expect
    .poll(async () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('voice-mind-map:workspace:v2')!).viewport.zoom,
      ),
    )
    .not.toBe(0.5);
  const rememberedViewport = await viewport.getAttribute('style');
  await page.getByRole('button', { name: '思路', exact: true }).click();
  await expect.poll(() => desk.evaluate((element) => element.scrollTop)).toBe(900);
  await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBe(260);
  await expect(page.locator('.desk-entry-title')).toHaveText('主题 2');
  const search = page.getByRole('textbox', { name: '找一个念头' });
  await search.fill('细想');
  await desk.evaluate((element) => {
    element.scrollTop = 600;
    element.dispatchEvent(new Event('scroll'));
  });
  await page.getByRole('button', { name: '导图', exact: true }).click();
  await expect(page.getByRole('button', { name: '收起连线说明', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(viewport).toHaveAttribute('style', rememberedViewport!);
  await page.getByRole('button', { name: '思路', exact: true }).click();
  await expect(search).toHaveValue('细想');
  await expect.poll(() => desk.evaluate((element) => element.scrollTop)).toBe(600);

  for (let index = 1; index <= 6; index++) {
    await search.fill(`细想 1 · ${index}`);
    await desk.locator('.desk-thought').first().click();
    await page.getByRole('button', { name: '先放一放', exact: true }).click();
    await expect(page.getByRole('button', { name: '↩ 放回眼前', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expect(page.getByRole('button', { name: '先放一放', exact: true })).toBeVisible();
  }
  await expect(input).toHaveValue('不管切到哪里，这个没写完的想法都要留着。');
  expect(errors).toEqual([]);
});

test('retries the failed request, preserves new writing, and cancels a later request', async ({
  page,
}) => {
  const requests: Array<{ input: string; document: typeof document }> = [];
  let finishLast: (() => void) | undefined;
  await page.route('**/api/mind-map/change', async (route) => {
    const request = route.request().postDataJSON();
    requests.push(request);
    if (requests.length === 1) {
      await route.fulfill({ status: 503, json: { error: '这次思考超时了，原有内容未改动。' } });
      return;
    }
    if (requests.length === 3)
      await new Promise<void>((resolve) => {
        finishLast = resolve;
      });
    await route
      .fulfill({
        json: {
          document: request.document,
          changeSet: {
            baseRevision: 1,
            summary: '保留原图，重新给出入口。',
            commands: [],
            navigation,
          },
          appliedCommands: [],
          rejectedCommands: [],
        },
      })
      .catch(() => undefined);
  });
  await prepare(page);
  const input = page.getByRole('textbox', { name: '待整理内容' });
  await input.fill('先整理这一个想法。');
  await page.getByRole('button', { name: '整理⌘↵' }).click();
  await expect(page.getByRole('button', { name: '重试上次整理' })).toBeVisible();
  await input.fill('等待时写下的另一个念头。');
  await page.getByRole('button', { name: '重试上次整理' }).click();
  await expect(page.getByRole('button', { name: '重试上次整理' })).toHaveCount(0);
  await expect(input).toHaveValue('等待时写下的另一个念头。');
  expect(requests[1].input).toBe(requests[0].input);
  const original = page.locator('summary').filter({ hasText: '原始输入' });
  await expect(original).toHaveText('原始输入 · 1');
  await page.getByRole('button', { name: '整理⌘↵' }).click();
  await expect.poll(() => requests.length).toBe(3);
  await page.getByRole('button', { name: '取消整理' }).click();
  await expect(page.getByRole('button', { name: '整理⌘↵' })).toBeEnabled();
  finishLast?.();
  await expect(input).toHaveValue('等待时写下的另一个念头。');
  await expect(original).toHaveText('原始输入 · 2');
});
