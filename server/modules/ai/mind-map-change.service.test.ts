import { describe, expect, it, vi } from 'vitest';
import { MindMapChangeRequestSchema, MindMapDocumentSchema } from '../../../shared/mind-map';
import type { MindMapChangeProvider } from './change-provider';
import { MindMapChangeService } from './mind-map-change.service';

const document = MindMapDocumentSchema.parse({
  schemaVersion: 2,
  revision: 3,
  title: '本地产品',
  root: {
    id: 'root',
    title: '本地产品',
    content: '',
    kind: 'topic',
    status: 'open',
    source: 'summary',
    children: [],
  },
  relations: [],
  groups: [],
});

describe('MindMapChangeService', () => {
  it('validates navigation and omits entries for nodes absent after application', async () => {
    const service = new MindMapChangeService({
      proposeChangeSet: vi.fn(async () => ({
        baseRevision: 3,
        summary: '换个入口',
        commands: [],
        navigation: [
          { nodeId: 'root', reason: '先澄清这个目标', nextStep: '比较两个具体选择' },
          { nodeId: 'missing', reason: '不可定位', nextStep: '不应出现' },
        ],
      })),
    });
    const result = await service.change(
      MindMapChangeRequestSchema.parse({ input: '换个切入点', document }),
    );
    expect(result.document).toEqual(document);
    expect(result.changeSet.navigation).toEqual([
      { nodeId: 'root', reason: '先澄清这个目标', nextStep: '比较两个具体选择' },
    ]);
  });
  it('guards, applies, increments revision, and validates the response', async () => {
    const provider: MindMapChangeProvider = {
      proposeChangeSet: vi.fn(async () => ({
        baseRevision: 3,
        summary: '增加离线优先',
        commands: [
          {
            type: 'addNode' as const,
            parentId: 'root',
            node: {
              id: 'offline',
              title: '离线优先',
              content: '',
              kind: 'idea' as const,
              status: 'open' as const,
              source: 'user' as const,
              children: [],
            },
          },
        ],
      })),
    };
    const result = await new MindMapChangeService(provider).change(
      MindMapChangeRequestSchema.parse({
        input: '这个产品必须离线优先',
        intent: 'manual',
        document,
      }),
    );
    expect(result.document.revision).toBe(4);
    expect(result.document.root.children[0]).toMatchObject({
      id: 'offline',
      source: 'user',
    });
    expect(result.appliedCommands).toHaveLength(1);
  });

  it('retries unknown target IDs, then safely preserves the raw input', async () => {
    const provider: MindMapChangeProvider = {
      proposeChangeSet: vi.fn(async () => ({
        baseRevision: 3,
        summary: '尝试更新',
        commands: [
          { type: 'updateNode' as const, nodeId: '本地产品', patch: { title: '错误命中' } },
        ],
      })),
    };
    const result = await new MindMapChangeService(provider).change(
      MindMapChangeRequestSchema.parse({ input: '补充本地产品', document }),
    );
    expect(provider.proposeChangeSet).toHaveBeenCalledTimes(2);
    expect(result.document.root.title).toBe('本地产品');
    expect(result.document.root.children[0]).toMatchObject({
      content: '补充本地产品',
      source: 'user',
    });
    expect(result.appliedCommands[0]?.type).toBe('addNode');
    expect(result.rejectedCommands).toEqual([]);
  });

  it('applies a corrected retry after the first command is rejected', async () => {
    const proposeChangeSet = vi
      .fn()
      .mockResolvedValueOnce({
        baseRevision: 3,
        summary: '错误目标',
        commands: [{ type: 'updateNode', nodeId: 'missing', patch: { title: '错误' } }],
      })
      .mockResolvedValueOnce({
        baseRevision: 3,
        summary: '已纠正并新增节点',
        commands: [
          {
            type: 'addNode',
            parentId: 'root',
            node: {
              id: 'corrected',
              title: '正确节点',
              content: '新增内容',
              kind: 'note',
              status: 'open',
              source: 'user',
              children: [],
            },
          },
        ],
      });
    const result = await new MindMapChangeService({ proposeChangeSet }).change(
      MindMapChangeRequestSchema.parse({ input: '新增内容', document }),
    );

    expect(proposeChangeSet).toHaveBeenCalledTimes(2);
    expect(result.document.root.children[0]?.id).toBe('corrected');
    expect(result.rejectedCommands).toEqual([]);
  });
});
