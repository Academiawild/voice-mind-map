import type { GraphEdge, GraphNode } from './mind-map';
import { MIND_MAP_THEME } from './mind-map-theme';

export interface GraphPosition {
  x: number;
  y: number;
}

export interface GraphSize {
  width: number;
  height: number;
}

export type LayoutDirection = 'right' | 'left' | 'down' | 'up';

export interface LayoutNodeMeta {
  direction: LayoutDirection;
}

interface LayoutInput {
  nodes: GraphNode[];
  edges: GraphEdge[];
  positionOverrides?: Record<string, GraphPosition>;
}

export interface MindMapLayout {
  positions: Record<string, GraphPosition>;
  sizes: Record<string, GraphSize>;
  meta: Record<string, LayoutNodeMeta>;
}

const ROOT_WIDTH = 360;
const ROOT_MIN_HEIGHT = 160;
const NODE_WIDTH = 300;
const NODE_MIN_HEIGHT = 132;
const DIRECTION_ORDER: LayoutDirection[] = ['right', 'left', 'down', 'up'];

function estimateVisualUnits(text: string) {
  return Array.from(text.trim()).reduce((total, character) => {
    return total + (/[\u2e80-\u9fff\uff01-\uff60]/u.test(character) ? 1 : 0.55);
  }, 0);
}

function estimateLineCount(text: string, unitsPerLine: number, maximum = Number.POSITIVE_INFINITY) {
  return Math.max(1, Math.min(maximum, Math.ceil(estimateVisualUnits(text) / unitsPerLine)));
}

function estimateNodeSize(node: GraphNode): GraphSize {
  const isRoot = !node.parentId;
  const emphasis = node.importance === undefined ? 0 : Math.max(0, node.importance - 0.5);
  const width = (isRoot ? ROOT_WIDTH : NODE_WIDTH) + emphasis * 80;
  const titleLines = estimateLineCount(node.title, isRoot ? 11 : 13);
  const contentLines = node.content.trim()
    ? estimateLineCount(node.content, isRoot ? 22 : 20, 3)
    : 0;
  const titleLineHeight = isRoot ? 36 : 27;
  const contentLineHeight = 20;
  const chromeHeight = isRoot ? 84 : 76;
  const height =
    Math.max(
      isRoot ? ROOT_MIN_HEIGHT : NODE_MIN_HEIGHT,
      titleLines * titleLineHeight + contentLines * contentLineHeight + chromeHeight,
    ) +
    emphasis * 24;

  return { width, height };
}

function overlaps(
  leftPosition: GraphPosition,
  leftSize: GraphSize,
  rightPosition: GraphPosition,
  rightSize: GraphSize,
) {
  const gap = 18;
  return !(
    leftPosition.x + leftSize.width + gap <= rightPosition.x ||
    rightPosition.x + rightSize.width + gap <= leftPosition.x ||
    leftPosition.y + leftSize.height + gap <= rightPosition.y ||
    rightPosition.y + rightSize.height + gap <= leftPosition.y
  );
}

function applyRelativePlacements(
  nodes: GraphNode[],
  positions: Record<string, GraphPosition>,
  sizes: Record<string, GraphSize>,
  meta: Record<string, LayoutNodeMeta>,
) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const constrained = nodes.filter((node) => node.relativePlacement);

  for (let pass = 0; pass < 3; pass += 1) {
    for (const node of constrained) {
      const placement = node.relativePlacement;
      const anchor = placement ? byId.get(placement.relativeTo) : undefined;
      if (!placement || !anchor || !positions[anchor.id]) {
        continue;
      }
      const anchorPosition = positions[anchor.id];
      const anchorSize = sizes[anchor.id];
      const nodeSize = sizes[node.id];
      const distance = placement.distance ?? MIND_MAP_THEME.spacing.levelGap;

      switch (placement.side) {
        case 'left':
          positions[node.id] = {
            x: anchorPosition.x - distance - nodeSize.width,
            y: anchorPosition.y + (anchorSize.height - nodeSize.height) / 2,
          };
          meta[node.id] = { direction: 'left' };
          break;
        case 'above':
          positions[node.id] = {
            x: anchorPosition.x + (anchorSize.width - nodeSize.width) / 2,
            y: anchorPosition.y - distance - nodeSize.height,
          };
          meta[node.id] = { direction: 'up' };
          break;
        case 'below':
          positions[node.id] = {
            x: anchorPosition.x + (anchorSize.width - nodeSize.width) / 2,
            y: anchorPosition.y + anchorSize.height + distance,
          };
          meta[node.id] = { direction: 'down' };
          break;
        case 'right':
        default:
          positions[node.id] = {
            x: anchorPosition.x + anchorSize.width + distance,
            y: anchorPosition.y + (anchorSize.height - nodeSize.height) / 2,
          };
          meta[node.id] = { direction: 'right' };
          break;
      }
    }
  }

  for (const node of constrained) {
    const placement = node.relativePlacement;
    if (!placement) {
      continue;
    }
    for (const other of nodes) {
      if (
        other.id === node.id ||
        other.id === placement.relativeTo ||
        !overlaps(positions[node.id], sizes[node.id], positions[other.id], sizes[other.id])
      ) {
        continue;
      }
      if (placement.side === 'left' || placement.side === 'right') {
        positions[node.id].y = positions[other.id].y + sizes[other.id].height + 24;
      } else {
        positions[node.id].x = positions[other.id].x + sizes[other.id].width + 24;
      }
    }
  }
}

function buildChildrenMap(nodes: GraphNode[]) {
  const children = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    if (!node.parentId) {
      continue;
    }
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((left, right) => {
      const leftOrder = left.layoutOrder ?? Number.POSITIVE_INFINITY;
      const rightOrder = right.layoutOrder ?? Number.POSITIVE_INFINITY;
      return leftOrder - rightOrder;
    });
  }
  return children;
}

function isHorizontal(direction: LayoutDirection) {
  return direction === 'left' || direction === 'right';
}

function measureCrossSpan(
  node: GraphNode,
  direction: LayoutDirection,
  childrenMap: Map<string, GraphNode[]>,
  sizes: Record<string, GraphSize>,
): number {
  const children = childrenMap.get(node.id) ?? [];
  const nodeSize = sizes[node.id];
  const ownCrossSize = isHorizontal(direction) ? nodeSize.height : nodeSize.width;
  if (children.length === 0) {
    return ownCrossSize;
  }

  const childrenSpan =
    children.reduce(
      (total, child) => total + measureCrossSpan(child, direction, childrenMap, sizes),
      0,
    ) +
    (children.length - 1) * MIND_MAP_THEME.spacing.siblingGap;
  return Math.max(ownCrossSize, childrenSpan);
}

function placeSubtree(input: {
  node: GraphNode;
  direction: LayoutDirection;
  mainPosition: number;
  crossStart: number;
  childrenMap: Map<string, GraphNode[]>;
  positions: Record<string, GraphPosition>;
  sizes: Record<string, GraphSize>;
  meta: Record<string, LayoutNodeMeta>;
}) {
  const { node, direction, mainPosition, crossStart, childrenMap, positions, sizes, meta } = input;
  const nodeSize = sizes[node.id];
  const crossSpan = measureCrossSpan(node, direction, childrenMap, sizes);

  if (isHorizontal(direction)) {
    positions[node.id] = {
      x: mainPosition,
      y: crossStart + (crossSpan - nodeSize.height) / 2,
    };
  } else {
    positions[node.id] = {
      x: crossStart + (crossSpan - nodeSize.width) / 2,
      y: mainPosition,
    };
  }
  meta[node.id] = { direction };

  const children = childrenMap.get(node.id) ?? [];
  let childCrossCursor = crossStart;

  for (const child of children) {
    const childSize = sizes[child.id];
    const childCrossSpan = measureCrossSpan(child, direction, childrenMap, sizes);
    let childMainPosition: number;

    switch (direction) {
      case 'left':
        childMainPosition = mainPosition - MIND_MAP_THEME.spacing.levelGap - childSize.width;
        break;
      case 'down':
        childMainPosition = mainPosition + nodeSize.height + MIND_MAP_THEME.spacing.levelGap;
        break;
      case 'up':
        childMainPosition = mainPosition - MIND_MAP_THEME.spacing.levelGap - childSize.height;
        break;
      case 'right':
      default:
        childMainPosition = mainPosition + nodeSize.width + MIND_MAP_THEME.spacing.levelGap;
        break;
    }

    placeSubtree({
      node: child,
      direction,
      mainPosition: childMainPosition,
      crossStart: childCrossCursor,
      childrenMap,
      positions,
      sizes,
      meta,
    });
    childCrossCursor += childCrossSpan + MIND_MAP_THEME.spacing.siblingGap;
  }
}

function assignRootBranches(children: GraphNode[]) {
  const groups: Record<LayoutDirection, GraphNode[]> = {
    right: [],
    left: [],
    down: [],
    up: [],
  };
  for (const child of children) {
    const direction = child.layoutDirection ?? 'right';
    groups[direction].push(child);
  }

  return groups;
}

function measureGroupSpan(
  nodes: GraphNode[],
  direction: LayoutDirection,
  childrenMap: Map<string, GraphNode[]>,
  sizes: Record<string, GraphSize>,
) {
  if (nodes.length === 0) {
    return 0;
  }
  return (
    nodes.reduce(
      (total, node) => total + measureCrossSpan(node, direction, childrenMap, sizes),
      0,
    ) +
    (nodes.length - 1) * MIND_MAP_THEME.spacing.siblingGap
  );
}

export function mindMapTreeLayout({ nodes, positionOverrides = {} }: LayoutInput): MindMapLayout {
  const root = nodes.find((node) => !node.parentId);
  if (!root) {
    return { positions: {}, sizes: {}, meta: {} };
  }

  const childrenMap = buildChildrenMap(nodes);
  const sizes = Object.fromEntries(nodes.map((node) => [node.id, estimateNodeSize(node)]));
  const rootSize = sizes[root.id];
  const positions: Record<string, GraphPosition> = {
    [root.id]: {
      x: -rootSize.width / 2,
      y: -rootSize.height / 2,
    },
  };
  const meta: Record<string, LayoutNodeMeta> = {
    [root.id]: { direction: 'right' },
  };
  const groups = assignRootBranches(childrenMap.get(root.id) ?? []);

  for (const direction of DIRECTION_ORDER) {
    const group = groups[direction];
    let crossCursor = -measureGroupSpan(group, direction, childrenMap, sizes) / 2;

    for (const child of group) {
      const childSize = sizes[child.id];
      const childCrossSpan = measureCrossSpan(child, direction, childrenMap, sizes);
      let mainPosition: number;

      switch (direction) {
        case 'left':
          mainPosition = -rootSize.width / 2 - MIND_MAP_THEME.spacing.rootGap - childSize.width;
          break;
        case 'down':
          mainPosition = rootSize.height / 2 + MIND_MAP_THEME.spacing.rootGap;
          break;
        case 'up':
          mainPosition = -rootSize.height / 2 - MIND_MAP_THEME.spacing.rootGap - childSize.height;
          break;
        case 'right':
        default:
          mainPosition = rootSize.width / 2 + MIND_MAP_THEME.spacing.rootGap;
          break;
      }

      placeSubtree({
        node: child,
        direction,
        mainPosition,
        crossStart: crossCursor,
        childrenMap,
        positions,
        sizes,
        meta,
      });
      crossCursor += childCrossSpan + MIND_MAP_THEME.spacing.siblingGap;
    }
  }

  Object.assign(positions, positionOverrides);
  applyRelativePlacements(nodes, positions, sizes, meta);
  Object.assign(positions, positionOverrides);
  return { positions, sizes, meta };
}
