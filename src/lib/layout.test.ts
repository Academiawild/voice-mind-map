import { describe, expect, it } from 'vitest';
import type { MindMapLayoutDirection } from '../../shared/mind-map';
import type { GraphNode } from './mind-map';
import { mindMapTreeLayout } from './layout';

function node(
  id: string,
  parentId: string | null,
  layoutDirection?: MindMapLayoutDirection,
  title = id,
  content = '',
  layoutOrder?: number,
): GraphNode {
  return {
    id,
    parentId,
    title,
    content,
    kind: 'topic',
    status: 'open',
    source: 'summary',
    layoutDirection,
    layoutOrder,
  };
}

describe('mindMapTreeLayout', () => {
  it('places AI-directed root branches in all four directions', () => {
    const layout = mindMapTreeLayout({
      nodes: [
        node('root', null),
        node('right', 'root', 'right'),
        node('left', 'root', 'left'),
        node('down', 'root', 'down'),
        node('up', 'root', 'up'),
      ],
      edges: [],
    });

    expect(layout.meta.right.direction).toBe('right');
    expect(layout.meta.left.direction).toBe('left');
    expect(layout.meta.down.direction).toBe('down');
    expect(layout.meta.up.direction).toBe('up');
    expect(layout.positions.right.x).toBeGreaterThan(0);
    expect(layout.positions.left.x).toBeLessThan(0);
    expect(layout.positions.down.y).toBeGreaterThan(0);
    expect(layout.positions.up.y).toBeLessThan(0);
  });

  it('inherits the root branch direction for all descendants', () => {
    const layout = mindMapTreeLayout({
      nodes: [
        node('root', null),
        node('branch', 'root', 'down'),
        node('child', 'branch', 'left'),
        node('grandchild', 'child'),
      ],
      edges: [],
    });

    expect(layout.meta.branch.direction).toBe('down');
    expect(layout.meta.child.direction).toBe('down');
    expect(layout.meta.grandchild.direction).toBe('down');
    expect(layout.positions.child.y).toBeGreaterThan(layout.positions.branch.y);
    expect(layout.positions.grandchild.y).toBeGreaterThan(layout.positions.child.y);
  });

  it('uses a neutral rightward fallback when AI gives no direction', () => {
    const layout = mindMapTreeLayout({
      nodes: [
        node('root', null),
        node('branch-a', 'root'),
        node('branch-b', 'root'),
        node('branch-c', 'root'),
        node('branch-d', 'root'),
      ],
      edges: [],
    });

    expect([
      layout.meta['branch-a'].direction,
      layout.meta['branch-b'].direction,
      layout.meta['branch-c'].direction,
      layout.meta['branch-d'].direction,
    ]).toEqual(['right', 'right', 'right', 'right']);
  });

  it('keeps sibling subtrees separated on their cross axis', () => {
    const layout = mindMapTreeLayout({
      nodes: [
        node('root', null),
        node('branch', 'root', 'right'),
        node('child-a', 'branch'),
        node('child-b', 'branch'),
      ],
      edges: [],
    });

    const firstBottom = layout.positions['child-a'].y + layout.sizes['child-a'].height;
    expect(layout.positions['child-b'].y).toBeGreaterThanOrEqual(firstBottom + 30);
  });

  it('executes AI-authored sibling reading order', () => {
    const layout = mindMapTreeLayout({
      nodes: [
        node('root', null),
        node('branch', 'root', 'right'),
        node('follow-up', 'branch', undefined, '后续事项', '', 30),
        node('prerequisite', 'branch', undefined, '前置条件', '', 10),
      ],
      edges: [],
    });

    expect(layout.positions.prerequisite.y).toBeLessThan(layout.positions['follow-up'].y);
  });

  it('grows the node height so long titles are not clipped', () => {
    const longTitle =
      '这是一个非常长的节点标题，用来确认即使缩小画布时也不会因为固定行数而被裁掉'.repeat(4);
    const layout = mindMapTreeLayout({
      nodes: [node('root', null), node('long-title', 'root', 'right', longTitle)],
      edges: [],
    });

    expect(layout.sizes['long-title'].height).toBeGreaterThan(300);
  });

  it('reserves enough height for wrapped Chinese content and metadata', () => {
    const layout = mindMapTreeLayout({
      nodes: [
        node('root', null),
        node(
          'content',
          'root',
          'right',
          '购买条件',
          '确认是否从正规供应商购买，并核对保修和付款方式。',
        ),
      ],
      edges: [],
    });

    expect(layout.sizes.content.height).toBeGreaterThanOrEqual(140);
  });

  it('executes AI-authored relative placement outside the tree direction', () => {
    const anchor = node('anchor', 'root', 'right');
    const placed = node('placed', 'root', 'right');
    placed.relativePlacement = {
      relativeTo: 'anchor',
      side: 'below',
      distance: 90,
    };
    const layout = mindMapTreeLayout({
      nodes: [node('root', null), anchor, placed],
      edges: [],
    });

    expect(layout.positions.placed.y).toBeGreaterThan(
      layout.positions.anchor.y + layout.sizes.anchor.height,
    );
    expect(layout.meta.placed.direction).toBe('down');
  });

  it('calculates relative placement from a manually moved anchor', () => {
    const anchor = node('anchor', 'root', 'right');
    const placed = node('placed', 'root', 'right');
    placed.relativePlacement = {
      relativeTo: 'anchor',
      side: 'right',
      distance: 100,
    };
    const layout = mindMapTreeLayout({
      nodes: [node('root', null), anchor, placed],
      edges: [],
      positionOverrides: {
        anchor: { x: 900, y: 400 },
      },
    });

    expect(layout.positions.anchor).toEqual({ x: 900, y: 400 });
    expect(layout.positions.placed.x).toBe(900 + layout.sizes.anchor.width + 100);
  });
});
