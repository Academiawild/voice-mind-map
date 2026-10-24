import { expect, test } from '@playwright/test';

const document = {
  schemaVersion: 2,
  revision: 1,
  title: '把生活想清楚',
  root: {
    id: 'root',
    title: '把生活想清楚',
    content: '',
    kind: 'topic',
    status: 'open',
    source: 'summary',
    children: [
      {
        id: 'work',
        title: '换一种工作方式',
        content: '想保留收入，也想有自己的时间',
        kind: 'question',
        status: 'open',
        source: 'user',
        children: [],
      },
      {
        id: 'learn',
        title: '学习梯度下降',
        content: '从小例子理解变化',
        kind: 'question',
        status: 'open',
        source: 'user',
        children: [],
      },
    ],
  },
  relations: [],
  groups: [],
};
const navigation = [
  {
    nodeId: 'work',
    reason: '先澄清期待，才能比較工作选择',
    nextStep: '分别写下想改变和想保留的一件事',
  },
  { nodeId: 'learn', reason: '另一件可以独立开始的事', nextStep: '先尝试一个数值例子' },
];

test('reads, responds, parks, restores and explores without losing the draft', async ({ page }) => {
  const requests: Array<{ input: string; selectedNodeId: string | null }> = [];
  await page.addInitScript(
    ({ document, navigation }) => {
      localStorage.setItem(
        'voice-mind-map:workspace:v2',
        JSON.stringify({
          document,
          navigation,
          positions: {},
          viewport: null,
          expandedInferenceNodeIds: [],
          savedInputs: [
            { id: 'original', text: '我的原始念头', createdAt: '2026-09-08T00:00:00Z' },
          ],
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
        runtimeId: 'desk-test',
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
  await page.route('**/api/mind-map/change', async (route) => {
    const request = route.request().postDataJSON();
    requests.push(request);
    await route.fulfill({
      json: {
        document: request.document,
        changeSet: {
          baseRevision: request.document.revision,
          summary: '给出进一步的思路',
          commands: [],
          navigation,
        },
        appliedCommands: [],
        rejectedCommands: [],
      },
    });
  });
  await page.goto('/');
  const desk = page.getByRole('region', { name: '思路桌面' });
  const recommendation = page.getByRole('region', { name: '推荐下一步' });
  const input = page.getByRole('textbox', { name: '待整理内容' });
  await expect(desk).toBeVisible();
  await expect(page.locator('.react-flow')).toHaveCount(0);
  await input.fill('没写完的想法');
  await page.getByRole('button', { name: '我来想一想 ↙' }).click();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(/没写完的想法\n关于/);
  expect(requests).toHaveLength(0);
  await page.getByRole('button', { name: '先放一放', exact: true }).click();
  await expect(
    recommendation.getByRole('button', { name: '学习梯度下降', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(
    recommendation.getByRole('button', { name: '换一种工作方式', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '想清楚了', exact: false }).click();
  await expect(
    recommendation.getByRole('button', { name: '学习梯度下降', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '重新打开', exact: false }).click();
  await expect(
    recommendation.getByRole('button', { name: '换一种工作方式', exact: true }),
  ).toBeVisible();

  const search = page.getByRole('textbox', { name: '找一个念头' });
  await search.fill('梯度');
  await desk.getByRole('button', { name: /学习梯度下降/ }).click();
  await page.getByRole('button', { name: '挑战一下', exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].selectedNodeId).toBe('learn');
  expect(requests[0].input).toContain('隐含前提');
  await expect(input).toHaveValue(/没写完的想法/);
  await page.getByRole('button', { name: '回到全图 ×', exact: true }).click();
  await page.getByRole('button', { name: '排个先后', exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].selectedNodeId).toBeNull();
  await page.locator('summary').filter({ hasText: '原始输入' }).click();
  await page.getByRole('button', { name: '带回输入框 ↙' }).click();
  await expect(input).toHaveValue(/没写完的想法[\s\S]*我的原始念头/);
  await expect(input).toBeFocused();

  await page.setViewportSize({ width: 800, height: 720 });
  await search.fill('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '导图', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await page.getByRole('button', { name: '思路', exact: true }).click();
  await expect(desk).toBeVisible();
  await expect(input).toHaveValue(/我的原始念头/);
});
