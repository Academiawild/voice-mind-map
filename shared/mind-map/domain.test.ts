import { describe, expect, it } from 'vitest';
import { applyMindMapChangeSet } from './commands';
import { guardMindMapChangeSet } from './policy';
import { enforceMindMapSourcePolicy } from './source-policy';
import { MindMapChangeSetSchema, MindMapDocumentSchema, type MindMapDocument } from './schema';

function createDocument(): MindMapDocument {
  return MindMapDocumentSchema.parse({
    schemaVersion: 2,
    revision: 4,
    title: '项目计划',
    root: {
      id: 'root',
      title: '项目计划',
      content: '',
      kind: 'topic',
      status: 'open',
      source: 'summary',
      children: [
        {
          id: 'fact',
          title: '预算一万元',
          content: '',
          kind: 'note',
          status: 'open',
          source: 'user',
          children: [],
        },
        {
          id: 'idea',
          title: '备选方案',
          content: '',
          kind: 'idea',
          status: 'open',
          source: 'inference',
          children: [],
        },
      ],
    },
    relations: [],
    groups: [],
  });
}

describe('mind-map v2 domain', () => {
  it('requires source and rejects dangling references', () => {
    expect(
      MindMapDocumentSchema.safeParse({
        schemaVersion: 2,
        revision: 0,
        title: '无效导图',
        root: {
          id: 'root',
          title: '无效导图',
          content: '',
          kind: 'topic',
          status: 'open',
          children: [],
        },
        relations: [],
        groups: [],
      }).success,
    ).toBe(false);

    expect(
      MindMapChangeSetSchema.safeParse({
        baseRevision: 0,
        summary: '旧协议',
        commands: [{ type: 'delete_node', node_id: 'root' }],
      }).success,
    ).toBe(false);
    expect(
      MindMapChangeSetSchema.safeParse({
        baseRevision: 0,
        summary: '额外字段',
        commands: [],
        mindMap: {},
      }).success,
    ).toBe(false);

    const document = createDocument();
    expect(
      MindMapDocumentSchema.safeParse({
        ...document,
        relations: [{ id: 'bad', sourceId: 'root', targetId: 'missing' }],
      }).success,
    ).toBe(false);
  });

  it('applies a strict change set and increments one revision', () => {
    const document = createDocument();
    const changeSet = MindMapChangeSetSchema.parse({
      baseRevision: 4,
      summary: '更新计划',
      commands: [
        {
          type: 'updateNode',
          nodeId: 'idea',
          patch: { title: '两个备选方案' },
        },
        {
          type: 'addNode',
          parentId: 'root',
          node: {
            id: 'next',
            title: '下一步',
            content: '比较候选方案',
            kind: 'task',
            status: 'open',
            source: 'summary',
            children: [],
          },
        },
      ],
    });

    const result = applyMindMapChangeSet(document, changeSet, { allowReplace: false });
    expect(result.rejectedCommands).toEqual([]);
    expect(result.appliedCommands).toHaveLength(2);
    expect(result.document?.revision).toBe(5);
    expect(result.document?.root.children.map((node) => node.title)).toEqual([
      '预算一万元',
      '两个备选方案',
      '下一步',
    ]);
  });

  it('rejects stale revisions and cycles', () => {
    const document = createDocument();
    const stale = MindMapChangeSetSchema.parse({
      baseRevision: 3,
      summary: '过期',
      commands: [{ type: 'deleteNode', nodeId: 'idea' }],
    });
    expect(applyMindMapChangeSet(document, stale, { allowReplace: false }).revisionConflict).toBe(
      true,
    );

    const cycle = MindMapChangeSetSchema.parse({
      baseRevision: 4,
      summary: '循环',
      commands: [{ type: 'moveNode', nodeId: 'fact', newParentId: 'fact' }],
    });
    expect(
      applyMindMapChangeSet(document, cycle, { allowReplace: false }).rejectedCommands[0]?.code,
    ).toBe('CYCLE');
  });

  it('protects user facts during automatic batch cleanup', () => {
    const document = createDocument();
    const changeSet = MindMapChangeSetSchema.parse({
      baseRevision: 4,
      summary: '清理',
      commands: [
        { type: 'deleteNode', nodeId: 'fact' },
        { type: 'deleteNode', nodeId: 'idea' },
      ],
    });
    const guarded = guardMindMapChangeSet({
      current: document,
      changeSet,
      userInput: '整理这段录音',
      intent: 'batch',
    });
    expect(guarded.acceptedCommands).toEqual([{ type: 'deleteNode', nodeId: 'idea' }]);
    expect(guarded.rejectedCommands[0]?.code).toBe('USER_FACT_PROTECTED');
  });

  it('allows replacement only for initialization or explicit reset', () => {
    const document = createDocument();
    const changeSet = MindMapChangeSetSchema.parse({
      baseRevision: 4,
      summary: '重建',
      commands: [
        {
          type: 'replaceDocument',
          document: {
            title: '新主题',
            root: {
              id: 'new-root',
              title: '新主题',
              content: '',
              kind: 'topic',
              status: 'open',
              source: 'user',
              children: [],
            },
            relations: [],
            groups: [],
          },
        },
      ],
    });
    expect(
      guardMindMapChangeSet({
        current: document,
        changeSet,
        userInput: '继续补充',
        intent: 'manual',
      }).acceptedCommands,
    ).toEqual([]);
    expect(
      guardMindMapChangeSet({
        current: document,
        changeSet,
        userInput: '清空并重新开始',
        intent: 'manual',
      }).acceptedCommands,
    ).toHaveLength(1);
  });

  it('allows initialization replacement for only the untouched default canvas', () => {
    const changeSet = MindMapChangeSetSchema.parse({
      baseRevision: 0,
      summary: '初始化',
      commands: [
        {
          type: 'replaceDocument',
          document: {
            title: '新主题',
            root: {
              id: 'root',
              title: '新主题',
              content: '',
              kind: 'topic',
              status: 'open',
              source: 'summary',
              children: [],
            },
            relations: [],
            groups: [],
          },
        },
      ],
    });
    const blank = MindMapDocumentSchema.parse({
      schemaVersion: 2,
      revision: 0,
      title: '新思维导图',
      root: {
        id: 'root',
        title: '新思维导图',
        content: '',
        kind: 'topic',
        status: 'open',
        source: 'user',
        children: [],
      },
      relations: [],
      groups: [],
    });
    expect(
      guardMindMapChangeSet({
        current: blank,
        changeSet,
        userInput: '整理新的想法',
        intent: 'manual',
      }).acceptedCommands,
    ).toHaveLength(1);

    const edited = MindMapDocumentSchema.parse({ ...blank, title: '已命名的导图' });
    expect(
      guardMindMapChangeSet({
        current: edited,
        changeSet,
        userInput: '继续补充',
        intent: 'manual',
      }).acceptedCommands,
    ).toEqual([]);
  });

  it('preserves user provenance and downgrades unsupported model claims', () => {
    const current = createDocument();
    const next = MindMapDocumentSchema.parse({
      ...current,
      revision: 5,
      root: {
        ...current.root,
        children: [
          { ...current.root.children[0]!, source: 'inference' },
          ...current.root.children.slice(1),
          {
            id: 'unsupported',
            title: '明年融资一亿元',
            content: '',
            kind: 'idea',
            status: 'open',
            source: 'user',
            children: [],
          },
        ],
      },
    });

    const corrected = enforceMindMapSourcePolicy(current, next, '继续补充项目计划');
    expect(corrected.root.children[0]?.source).toBe('user');
    expect(corrected.root.children.at(-1)?.source).toBe('summary');
  });
});
