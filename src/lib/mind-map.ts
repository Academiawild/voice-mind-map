import type { Edge, Node } from '@xyflow/react';
import { MarkerType, Position } from '@xyflow/react';
import {
  countMindMapNodes,
  findMindMapNodeById,
  flattenMindMapNodes,
  type MindMapDocument,
  type MindMapNode,
} from '../../shared/mind-map';
import { mindMapTreeLayout, type LayoutDirection } from './layout';
import { MIND_MAP_THEME } from './mind-map-theme';

export interface RenderedMindMap {
  nodes: Node[];
  edges: Edge[];
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  hiddenInferenceCounts: Record<string, number>;
}

export type GraphNode = Omit<MindMapNode, 'children'> & { parentId: string | null };
export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  relation?: boolean;
  dashed?: boolean;
};

function countSubtreeNodes(node: MindMapNode): number {
  return 1 + node.children.reduce((total, child) => total + countSubtreeNodes(child), 0);
}

function flattenNode(
  node: MindMapNode,
  parentId: string | null,
  graphNodes: GraphNode[],
  graphEdges: GraphEdge[],
  hiddenInferenceCounts: Record<string, number>,
  expandedInferenceNodeIds: ReadonlySet<string>,
  collapsedNodeIds: ReadonlySet<string>,
  insideInferenceBranch = false,
) {
  graphNodes.push({
    id: node.id,
    title: node.title,
    content: node.content,
    kind: node.kind,
    status: node.status,
    source: node.source,
    layoutDirection: node.layoutDirection,
    layoutOrder: node.layoutOrder,
    relativePlacement: node.relativePlacement,
    importance: node.importance,
    parentId,
  });

  if (parentId) {
    graphEdges.push({
      id: `${parentId}->${node.id}`,
      source: parentId,
      target: node.id,
    });
  }

  if (collapsedNodeIds.has(node.id)) return;

  for (const child of node.children) {
    const startsInferenceBranch = child.source === 'inference' && !insideInferenceBranch;
    if (startsInferenceBranch) {
      hiddenInferenceCounts[node.id] =
        (hiddenInferenceCounts[node.id] ?? 0) + countSubtreeNodes(child);
      if (!expandedInferenceNodeIds.has(node.id)) {
        continue;
      }
    }
    flattenNode(
      child,
      node.id,
      graphNodes,
      graphEdges,
      hiddenInferenceCounts,
      expandedInferenceNodeIds,
      collapsedNodeIds,
      insideInferenceBranch || startsInferenceBranch,
    );
  }
}

export { countMindMapNodes, findMindMapNodeById };

function sourcePositionForDirection(direction: LayoutDirection) {
  switch (direction) {
    case 'left':
      return Position.Left;
    case 'up':
      return Position.Top;
    case 'down':
      return Position.Bottom;
    case 'right':
    default:
      return Position.Right;
  }
}

function targetPositionForDirection(direction: LayoutDirection) {
  switch (direction) {
    case 'left':
      return Position.Right;
    case 'up':
      return Position.Bottom;
    case 'down':
      return Position.Top;
    case 'right':
    default:
      return Position.Left;
  }
}

function sourceHandleForDirection(direction: LayoutDirection) {
  switch (direction) {
    case 'left':
      return 'source-left';
    case 'up':
      return 'source-top';
    case 'down':
      return 'source-bottom';
    case 'right':
    default:
      return 'source-right';
  }
}

function targetHandleForDirection(direction: LayoutDirection) {
  switch (direction) {
    case 'left':
      return 'target-right';
    case 'up':
      return 'target-bottom';
    case 'down':
      return 'target-top';
    case 'right':
    default:
      return 'target-left';
  }
}

function directionBetween(
  sourceId: string,
  targetId: string,
  layout: ReturnType<typeof mindMapTreeLayout>,
): LayoutDirection {
  const source = layout.positions[sourceId];
  const target = layout.positions[targetId];
  const sourceSize = layout.sizes[sourceId];
  const targetSize = layout.sizes[targetId];
  if (!source || !target || !sourceSize || !targetSize) {
    return 'right';
  }
  const deltaX = target.x + targetSize.width / 2 - (source.x + sourceSize.width / 2);
  const deltaY = target.y + targetSize.height / 2 - (source.y + sourceSize.height / 2);
  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    return deltaX >= 0 ? 'right' : 'left';
  }
  return deltaY >= 0 ? 'down' : 'up';
}

export function mindMapToReactFlow(
  mindMap: MindMapDocument | null,
  focusedNodeId: string | null,
  positionOverrides: Record<string, { x: number; y: number }> = {},
  expandedInferenceNodeIds: ReadonlySet<string> = new Set(),
  changedNodeIds: ReadonlySet<string> = new Set(),
  collapsedNodeIds: ReadonlySet<string> = new Set(),
): RenderedMindMap {
  if (!mindMap) {
    return {
      nodes: [],
      edges: [],
      graphNodes: [],
      graphEdges: [],
      hiddenInferenceCounts: {},
    };
  }

  const graphNodes: GraphNode[] = [];
  const graphEdges: GraphEdge[] = [];
  const hiddenInferenceCounts: Record<string, number> = {};
  flattenNode(
    mindMap.root,
    null,
    graphNodes,
    graphEdges,
    hiddenInferenceCounts,
    expandedInferenceNodeIds,
    collapsedNodeIds,
  );

  const visibleNodeIds = new Set(graphNodes.map((node) => node.id));
  for (const relation of mindMap.relations ?? []) {
    if (visibleNodeIds.has(relation.sourceId) && visibleNodeIds.has(relation.targetId)) {
      graphEdges.push({
        id: `relation:${relation.id}`,
        source: relation.sourceId,
        target: relation.targetId,
        label: relation.label,
        relation: true,
        dashed: relation.dashed,
      });
    }
  }

  const layout = mindMapTreeLayout({
    nodes: graphNodes,
    edges: graphEdges,
    positionOverrides,
  });

  const nodes: Node[] = graphNodes.map((node) => {
    const direction = layout.meta[node.id]?.direction ?? 'right';
    return {
      id: node.id,
      type: 'canvasNode',
      position: layout.positions[node.id] ?? { x: 0, y: 0 },
      sourcePosition: sourcePositionForDirection(direction),
      targetPosition: targetPositionForDirection(direction),
      data: {
        node,
        direction,
        focused: focusedNodeId === node.id,
        changed: changedNodeIds.has(node.id),
        inferenceCount: hiddenInferenceCounts[node.id] ?? 0,
        inferenceExpanded: expandedInferenceNodeIds.has(node.id),
      },
      draggable: true,
      style: {
        width: layout.sizes[node.id]?.width ?? (node.parentId ? 300 : 360),
        height: layout.sizes[node.id]?.height,
        background: 'transparent',
        border: 'none',
      },
      zIndex: 2,
    };
  });

  const renderedById = new Map(nodes.map((node) => [node.id, node]));
  const groups: Node[] = (mindMap.groups ?? []).flatMap((group) => {
    const members = group.memberIds
      .map((nodeId) => renderedById.get(nodeId))
      .filter((node): node is Node => Boolean(node));
    if (members.length === 0) {
      return [];
    }
    const padding = 44;
    const minX = Math.min(...members.map((node) => node.position.x)) - padding;
    const minY = Math.min(...members.map((node) => node.position.y)) - padding - 18;
    const maxX =
      Math.max(...members.map((node) => node.position.x + Number(node.style?.width ?? 300))) +
      padding;
    const maxY =
      Math.max(...members.map((node) => node.position.y + Number(node.style?.height ?? 132))) +
      padding;
    return [
      {
        id: `group:${group.id}`,
        type: 'canvasGroup',
        position: { x: minX, y: minY },
        data: { label: group.label },
        draggable: false,
        selectable: false,
        connectable: false,
        focusable: false,
        zIndex: -1,
        style: {
          width: maxX - minX,
          height: maxY - minY,
          pointerEvents: 'none',
        },
      },
    ];
  });

  const edges: Edge[] = graphEdges.map((edge) => {
    const isRelation = edge.relation === true;
    const edgeDirection = isRelation
      ? directionBetween(edge.source, edge.target, layout)
      : (layout.meta[edge.target]?.direction ?? 'right');
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: sourceHandleForDirection(edgeDirection),
      targetHandle: targetHandleForDirection(edgeDirection),
      label: edge.label,
      markerEnd: isRelation
        ? { type: MarkerType.ArrowClosed, color: '#9a7652', width: 14, height: 14 }
        : undefined,
      animated: focusedNodeId === edge.target && !isRelation,
      type: isRelation ? 'smoothstep' : MIND_MAP_THEME.edge.type,
      style: {
        stroke: isRelation
          ? '#64748b'
          : focusedNodeId === edge.target
            ? MIND_MAP_THEME.root.borderColor
            : MIND_MAP_THEME.edge.stroke,
        strokeWidth: isRelation
          ? 2
          : focusedNodeId === edge.target
            ? 2
            : MIND_MAP_THEME.edge.strokeWidth,
        strokeDasharray: edge.dashed ? '7 6' : undefined,
        opacity: focusedNodeId === edge.target ? 1 : isRelation ? 0.78 : 0.9,
      },
      labelStyle: isRelation ? { fill: '#475569', fontSize: 12, fontWeight: 600 } : undefined,
      labelBgStyle: isRelation ? { fill: '#ffffff', fillOpacity: 0.9 } : undefined,
      labelBgPadding: isRelation ? [6, 3] : undefined,
      labelBgBorderRadius: isRelation ? 5 : undefined,
    };
  });

  return {
    nodes: [...groups, ...nodes],
    edges,
    graphNodes,
    graphEdges,
    hiddenInferenceCounts,
  };
}

export function findChangedMindMapNodeIds(current: MindMapDocument | null, next: MindMapDocument) {
  const signature = (node: MindMapNode) =>
    [
      node.title,
      node.content,
      node.kind,
      node.status,
      node.source ?? '',
      node.layoutDirection ?? '',
      node.layoutOrder ?? '',
      JSON.stringify(node.relativePlacement ?? null),
      node.importance ?? '',
    ].join('\n');
  const currentNodes = new Map(
    flattenMindMapNodes(current).map((node) => [node.id, signature(node)]),
  );

  return new Set(
    flattenMindMapNodes(next)
      .filter((node) => {
        return currentNodes.get(node.id) !== signature(node);
      })
      .map((node) => node.id),
  );
}
