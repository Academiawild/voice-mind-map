import { expect, test } from '@playwright/test';

const node = (id: string, title: string) => ({
  id,
  title,
  content: '',
  kind: 'question',
  status: 'open',
  source: 'summary',
  children: [],
});
const document = {
  schemaVersion: 2,
  revision: 1,
  title: '生活与选择',
  root: {
    ...node('root', '生活与选择'),
    kind: 'topic',
    children: [
      { ...node('desire', '我真正想要什么'), children: [node('choice', '想改变什么')] },
      node('stable', '稳定意味着什么'),
      node('learn', '理解梯度下降'),
    ],
  },
  relations: [
    {
      id: 'tension',
      sourceId: 'desire',
      targetId: 'stable',
      label: '可能：新鲜感与可预期之间存在张力',
      dashed: true,
    },
  ],
  groups: [],
};
const navigation = [
  {
    nodeId: 'desire',
    reason: '澄清期待可以帮助比较生活与关系中的选择。',
    nextStep: '分别写出想改变和不愿失去的一件事。',
  },
];

test('connects navigation, local focus, correction, whole-map analysis and original input recovery', async ({
  page,
}) => {
  const requests: Array<{ document: unknown; input: string; selectedNodeId: string | null }> = [];
  await page.route('**/api/status', (route) =>
    route.fulfill({
      json: {
        ok: true,
        service: 'voice-mind-map',
        runtimeId: 'navigation-test',
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
    const commands = request.document
      ? []
      : [
          {
            type: 'replaceDocument',
            document: {
              title: document.title,
              root: document.root,
              relations: document.relations,
              groups: [],
            },
          },
        ];
    await route.fulfill({
      json: {
        document,
        changeSet: {
          baseRevision: request.document ? 1 : 0,
          summary: '找到生活选择之间的联系',
          commands,
          navigation,
        },
        appliedCommands: commands,
        rejectedCommands: [],
      },
    });
  });
  await page.goto('/');
  await page
    .getByRole('textbox', { name: '待整理内容' })
    .fill('欲望、稳定、生活方式，还有梯度下降是什么。');
  await page.getByRole('button', { name: '整理⌘↵' }).click();
  await page.getByRole('button', { name: '导图', exact: true }).click();
  const compass = page.getByRole('complementary', { name: '思考导航' });
  await expect(compass.getByText(navigation[0].reason)).toBeVisible();
  await expect(compass.getByText(navigation[0].nextStep)).toBeVisible();
  await expect(compass.getByText(document.relations[0].label)).toBeVisible();
  await compass.locator('.thinking-entry-title').click();
  await expect(page.getByText('围绕「我真正想要什么」继续')).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="learn"]')).toHaveCSS('opacity', '0.22');
  await compass.getByRole('button', { name: '这条联系不对' }).click();
  await expect(page.getByRole('textbox', { name: '待整理内容' })).toBeFocused();
  await expect(page.getByRole('textbox', { name: '待整理内容' })).toHaveValue(/请纠正联系 tension/);
  await compass.getByRole('button', { name: '换个切入点' }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].selectedNodeId).toBeNull();
  await expect(page.getByRole('textbox', { name: '待整理内容' })).toHaveValue(/请纠正联系 tension/);
  await page.reload();
  await page.getByRole('button', { name: '导图', exact: true }).click();
  await expect(compass.getByText(navigation[0].reason)).toBeVisible();
  await compass.locator('summary').filter({ hasText: '原始输入' }).click();
  await expect(
    compass.getByText('欲望、稳定、生活方式，还有梯度下降是什么。', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '收起生活与选择分支', exact: true }).click();
  await expect(page.locator('.react-flow__node[data-id="desire"]')).toHaveCount(0);
  await compass.locator('.thinking-entry-title').click();
  await expect(page.locator('.react-flow__node[data-id="desire"]')).toBeVisible();
  await page.getByRole('button', { name: '只看主题', exact: true }).click();
  await expect(page.locator('.react-flow__node[data-id="choice"]')).toHaveCount(0);
  await page.getByRole('button', { name: '展开全图', exact: true }).click();
  await expect(page.locator('.react-flow__node[data-id="choice"]')).toBeVisible();
});
