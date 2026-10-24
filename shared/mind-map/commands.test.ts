import { describe, expect, it } from 'vitest';
import { summarizeMindMapCommands } from './activity';
import { applyMindMapChangeSet } from './commands';
import { guardMindMapChangeSet } from './policy';
import {
  MindMapChangeSetSchema,
  MindMapDocumentSchema,
  type MindMapCommand,
  type MindMapDocument,
  type MindMapNode,
} from './schema';

function node(id: string, children: MindMapNode[] = []): MindMapNode {
  return {
    id,
    title: id,
    content: '',
    kind: 'topic' as const,
    status: 'open' as const,
    source: 'summary' as const,
    children,
  };
}

function document(): MindMapDocument {
  return MindMapDocumentSchema.parse({
    schemaVersion: 2,
    revision: 7,
    title: 'root',
    root: {
      ...node('root', [
        { ...node('a', [node('a1')]), source: 'user' },
        { ...node('b'), layoutOrder: 2, importance: 0.7 },
        {
          ...node('c'),
          relativePlacement: { relativeTo: 'b', side: 'below' as const },
        },
      ]),
    },
    relations: [{ id: 'b-c', sourceId: 'b', targetId: 'c' }],
    groups: [{ id: 'pair', label: 'Pair', memberIds: ['b', 'c'] }],
  });
}

function change(commands: MindMapCommand[], baseRevision = 7) {
  return MindMapChangeSetSchema.parse({ baseRevision, summary: 'test', commands });
}

describe('applyMindMapChangeSet command coverage', () => {
  it('handles replacement permissions and commands without a document', () => {
    const replacement: MindMapCommand = {
      type: 'replaceDocument',
      document: { title: 'new', root: node('new'), relations: [], groups: [] },
    };
    expect(
      applyMindMapChangeSet(document(), change([replacement]), { allowReplace: false })
        .rejectedCommands[0]?.code,
    ).toBe('REPLACE_NOT_ALLOWED');
    expect(
      applyMindMapChangeSet(
        null,
        change([{ type: 'addNode', parentId: 'x', node: node('y') }], 0),
        {
          allowReplace: true,
        },
      ).rejectedCommands[0]?.code,
    ).toBe('DOCUMENT_REQUIRED');
    expect(
      applyMindMapChangeSet(null, change([replacement], 0), { allowReplace: true }).document,
    ).toMatchObject({ revision: 1, title: 'new' });
  });

  it('rejects invalid add targets, duplicate ids, and node budget overflow', () => {
    expect(
      applyMindMapChangeSet(
        document(),
        change([{ type: 'addNode', parentId: 'missing', node: node('new') }]),
        { allowReplace: false },
      ).rejectedCommands[0]?.code,
    ).toBe('PARENT_NOT_FOUND');
    expect(
      applyMindMapChangeSet(
        document(),
        change([{ type: 'addNode', parentId: 'root', node: node('a') }]),
        { allowReplace: false },
      ).rejectedCommands[0]?.code,
    ).toBe('DUPLICATE_NODE_ID');

    const full = MindMapDocumentSchema.parse({
      schemaVersion: 2,
      revision: 0,
      title: 'full',
      root: node(
        'full',
        Array.from({ length: 199 }, (_, index) => node(`n-${index}`)),
      ),
      relations: [],
      groups: [],
    });
    expect(
      applyMindMapChangeSet(
        full,
        change([{ type: 'addNode', parentId: 'full', node: node('overflow') }], 0),
        { allowReplace: false },
      ).rejectedCommands[0]?.code,
    ).toBe('NODE_LIMIT');
  });

  it('updates root metadata, clears optional placement fields, and rejects bad targets', () => {
    const result = applyMindMapChangeSet(
      document(),
      change([
        { type: 'updateNode', nodeId: 'root', patch: { title: 'renamed' } },
        {
          type: 'updateNode',
          nodeId: 'b',
          patch: { layoutOrder: null, importance: null, relativePlacement: null },
        },
      ]),
      { allowReplace: false },
    );
    expect(result.document?.title).toBe('renamed');
    expect(
      result.document?.root.children.find((candidate) => candidate.id === 'b'),
    ).not.toHaveProperty('layoutOrder');

    const missing = applyMindMapChangeSet(
      document(),
      change([{ type: 'updateNode', nodeId: 'missing', patch: { title: 'x' } }]),
      { allowReplace: false },
    );
    expect(missing.rejectedCommands[0]?.code).toBe('NODE_NOT_FOUND');
    const badPlacement = applyMindMapChangeSet(
      document(),
      change([
        {
          type: 'updateNode',
          nodeId: 'b',
          patch: { relativePlacement: { relativeTo: 'missing', side: 'right' } },
        },
      ]),
      { allowReplace: false },
    );
    expect(badPlacement.rejectedCommands[0]?.code).toBe('INVALID_PLACEMENT');
  });

  it('deletes subtrees and their dangling relation, group, and placement references', () => {
    const rootDelete = applyMindMapChangeSet(
      document(),
      change([{ type: 'deleteNode', nodeId: 'root' }]),
      { allowReplace: false },
    );
    expect(rootDelete.rejectedCommands[0]?.code).toBe('ROOT_PROTECTED');
    const missing = applyMindMapChangeSet(
      document(),
      change([{ type: 'deleteNode', nodeId: 'missing' }]),
      { allowReplace: false },
    );
    expect(missing.rejectedCommands[0]?.code).toBe('NODE_NOT_FOUND');

    const result = applyMindMapChangeSet(
      document(),
      change([{ type: 'deleteNode', nodeId: 'b' }]),
      { allowReplace: false },
    );
    expect(result.document?.relations).toEqual([]);
    expect(result.document?.groups[0]?.memberIds).toEqual(['c']);
    expect(
      result.document?.root.children.find((candidate) => candidate.id === 'c'),
    ).not.toHaveProperty('relativePlacement');
  });

  it('moves nodes while protecting roots, missing targets, and cycles', () => {
    const commands: MindMapCommand[] = [
      { type: 'moveNode', nodeId: 'root', newParentId: 'b' },
      { type: 'moveNode', nodeId: 'missing', newParentId: 'b' },
      { type: 'moveNode', nodeId: 'a', newParentId: 'a1' },
      { type: 'moveNode', nodeId: 'c', newParentId: 'a1' },
    ];
    const result = applyMindMapChangeSet(document(), change(commands), { allowReplace: false });
    expect(result.rejectedCommands.map((item) => item.code)).toEqual([
      'ROOT_PROTECTED',
      'NODE_NOT_FOUND',
      'CYCLE',
    ]);
    expect(result.appliedCommands).toEqual([commands[3]]);
  });

  it('upserts and deletes relations and groups with complete-result validation', () => {
    const result = applyMindMapChangeSet(
      document(),
      change([
        { type: 'upsertRelation', relation: { id: 'a-b', sourceId: 'a', targetId: 'b' } },
        { type: 'deleteRelation', relationId: 'b-c' },
        { type: 'upsertGroup', group: { id: 'solo', label: 'Solo', memberIds: ['a'] } },
        { type: 'deleteGroup', groupId: 'pair' },
      ]),
      { allowReplace: false },
    );
    expect(result.rejectedCommands).toEqual([]);
    expect(result.document?.relations.map((relation) => relation.id)).toEqual(['a-b']);
    expect(result.document?.groups.map((group) => group.id)).toEqual(['solo']);

    const rejected = applyMindMapChangeSet(
      document(),
      change([
        { type: 'deleteRelation', relationId: 'missing' },
        { type: 'deleteGroup', groupId: 'missing' },
        {
          type: 'upsertRelation',
          relation: { id: 'bad', sourceId: 'a', targetId: 'missing' },
        },
        { type: 'upsertGroup', group: { id: 'bad', label: 'Bad', memberIds: ['missing'] } },
      ]),
      { allowReplace: false },
    );
    expect(rejected.rejectedCommands.map((item) => item.code)).toEqual([
      'RELATION_NOT_FOUND',
      'GROUP_NOT_FOUND',
      'INVALID_RESULT',
      'INVALID_RESULT',
    ]);
  });

  it('summarizes every command family for activity UI', () => {
    const commands: MindMapCommand[] = [
      { type: 'addNode', parentId: 'root', node: node('new') },
      { type: 'updateNode', nodeId: 'a', patch: { title: 'A' } },
      { type: 'moveNode', nodeId: 'b', newParentId: 'a' },
      { type: 'deleteNode', nodeId: 'c' },
      { type: 'upsertRelation', relation: { id: 'r', sourceId: 'a', targetId: 'b' } },
      { type: 'deleteRelation', relationId: 'r' },
      { type: 'upsertGroup', group: { id: 'g', label: 'G', memberIds: ['a'] } },
      { type: 'deleteGroup', groupId: 'g' },
      {
        type: 'replaceDocument',
        document: { title: 'new', root: node('new-root'), relations: [], groups: [] },
      },
    ];
    expect(summarizeMindMapCommands(commands)).toMatchObject({
      added: 1,
      updated: 1,
      moved: 1,
      deleted: 1,
      relations: 2,
      groups: 2,
      replaced: true,
    });
  });
});

describe('guardMindMapChangeSet policy coverage', () => {
  it('requires explicit deletion outside batch and enforces the batch budget', () => {
    const map = document();
    const command = change([{ type: 'deleteNode', nodeId: 'b' }]);
    expect(
      guardMindMapChangeSet({
        current: map,
        changeSet: command,
        userInput: '继续整理',
        intent: 'manual',
      }).rejectedCommands[0]?.code,
    ).toBe('DELETE_NOT_REQUESTED');

    const large = change([
      { type: 'deleteNode', nodeId: 'b' },
      { type: 'deleteNode', nodeId: 'c' },
      { type: 'deleteNode', nodeId: 'a' },
    ]);
    const budgeted = guardMindMapChangeSet({
      current: map,
      changeSet: large,
      userInput: '删除不需要的分支',
      intent: 'manual',
    });
    expect(budgeted.acceptedCommands).toHaveLength(2);
    expect(budgeted.rejectedCommands[0]?.code).toBe('DELETE_BUDGET');
    expect(
      guardMindMapChangeSet({
        current: map,
        changeSet: change([{ type: 'deleteNode', nodeId: 'missing' }]),
        userInput: '整理',
        intent: 'batch',
      }).acceptedCommands,
    ).toHaveLength(1);
  });
});
