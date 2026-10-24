import { describe, expect, it } from 'vitest';
import type { MindMapDocument } from '../../shared/mind-map';
import { findChangedMindMapNodeIds, mindMapToReactFlow } from './mind-map';

const MAP_WITH_INFERENCE: MindMapDocument = {
  schemaVersion: 2,
  revision: 0,
  title: '产品计划',
  root: {
    id: 'root',
    title: '产品计划',
    content: '',
    kind: 'topic',
    status: 'open',
    source: 'summary',
    children: [
      {
        id: 'facts',
        title: '明确需求',
        content: '用户已经说明的需求',
        kind: 'note',
        status: 'open',
        source: 'user',
        children: [],
      },
      {
        id: 'suggestion',
        title: '建议先做测试',
        content: '模型补充的建议',
        kind: 'idea',
        status: 'open',
        source: 'inference',
        children: [
          {
            id: 'suggestion-detail',
            title: '测试小范围用户',
            content: '',
            kind: 'task',
            status: 'open',
            source: 'inference',
            children: [],
          },
        ],
      },
    ],
  },
  relations: [],
  groups: [],
};

describe('mind map rendering', () => {
  it('collapses ordinary branches without leaving dangling relations', () => {
    const map = structuredClone(MAP_WITH_INFERENCE);
    map.relations = [{ id: 'r', sourceId: 'root', targetId: 'facts', label: '包含需求' }];
    const rendered = mindMapToReactFlow(map, null, {}, new Set(), new Set(), new Set(['root']));
    expect(rendered.graphNodes.map((node) => node.id)).toEqual(['root']);
    expect(rendered.edges).toEqual([]);
    expect(map.root.children).toHaveLength(2);
  });
  it('hides inference branches until their source node is expanded', () => {
    const collapsed = mindMapToReactFlow(MAP_WITH_INFERENCE, null);
    expect(collapsed.graphNodes.map((node) => node.id)).toEqual(['root', 'facts']);
    expect(collapsed.hiddenInferenceCounts.root).toBe(2);

    const expanded = mindMapToReactFlow(MAP_WITH_INFERENCE, null, {}, new Set(['root']));
    expect(expanded.graphNodes.map((node) => node.id)).toEqual([
      'root',
      'facts',
      'suggestion',
      'suggestion-detail',
    ]);
  });

  it('marks only added or updated nodes as changed', () => {
    const next = structuredClone(MAP_WITH_INFERENCE);
    next.root.children[0].content = '更新后的明确需求';
    next.root.children.push({
      id: 'new-node',
      title: '新增节点',
      content: '',
      kind: 'note',
      status: 'open',
      source: 'summary',
      children: [],
    });

    expect(findChangedMindMapNodeIds(MAP_WITH_INFERENCE, next)).toEqual(
      new Set(['facts', 'new-node']),
    );
  });

  it('renders AI-authored relation edges and visual group backgrounds', () => {
    const map = structuredClone(MAP_WITH_INFERENCE);
    map.relations = [
      {
        id: 'facts_to_root',
        sourceId: 'facts',
        targetId: 'root',
        label: '支撑',
        dashed: true,
      },
    ];
    map.groups = [
      {
        id: 'evidence',
        label: '依据区域',
        memberIds: ['root', 'facts'],
      },
    ];

    const rendered = mindMapToReactFlow(map, null);
    expect(rendered.edges).toContainEqual(
      expect.objectContaining({
        id: 'relation:facts_to_root',
        label: '支撑',
      }),
    );
    expect(rendered.nodes).toContainEqual(
      expect.objectContaining({
        id: 'group:evidence',
        type: 'canvasGroup',
      }),
    );
  });
});
