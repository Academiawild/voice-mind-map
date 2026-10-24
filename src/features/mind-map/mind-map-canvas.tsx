import {
  Background,
  Handle,
  Position,
  ReactFlow,
  type NodeTypes,
  useReactFlow,
  useViewport,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import '@xyflow/react/dist/style.css';
import type { MindMapDocument, MindMapNode } from '../../../shared/mind-map';
import { mindMapToReactFlow, type GraphNode } from '../../lib/mind-map';
import type { MindMapPosition, MindMapViewport } from '../../lib/mind-map-view-state';

interface MindMapCanvasProps {
  mindMap: MindMapDocument | null;
  focusedNodeId: string | null;
  onFocusNodeChange: (nodeId: string | null) => void;
  positionOverrides: Record<string, MindMapPosition>;
  onPositionChange: (nodeId: string, position: MindMapPosition) => void;
  viewport: MindMapViewport | null;
  onViewportChange: (viewport: MindMapViewport) => void;
  expandedInferenceNodeIds: ReadonlySet<string>;
  onToggleInference: (nodeId: string) => void;
  changedNodeIds: ReadonlySet<string>;
  onUpdateNode: (
    nodeId: string,
    patch: Partial<Pick<MindMapNode, 'title' | 'content' | 'kind' | 'status' | 'layoutDirection'>>,
  ) => void;
  onExpandWithAi: (nodeId: string) => void;
  onDeleteBranch: (nodeId: string) => void;
  fitRequest?: number;
  collapsedNodeIds?: string[];
  onToggleCollapse?: (nodeId: string) => void;
  aiBusy?: boolean;
  onOverview?: () => void;
  showAllRelations?: boolean;
  onShowAllRelationsChange?: (value: boolean) => void;
}

interface CanvasNodeData {
  node: GraphNode;
  direction: string;
  focused: boolean;
  changed: boolean;
  inferenceCount: number;
  inferenceExpanded: boolean;
  onToggleInference: (nodeId: string) => void;
  onExpandWithAi: (nodeId: string) => void;
  onDeleteBranch: (nodeId: string) => void;
  childCount: number;
  collapsed: boolean;
  onToggleCollapse?: (nodeId: string) => void;
  aiBusy: boolean;
}

function CanvasNode({ data }: { data: CanvasNodeData }) {
  const { zoom } = useViewport();
  const node = data.node;
  const source = node.source ?? 'summary';
  const direction = data.direction || 'right';
  const rootClass = node.parentId ? 'mind-node-branch' : 'mind-node-root';
  const compactClass = zoom < 0.62 ? 'semantic-compact' : '';

  return (
    <div
      className={`mind-node ${rootClass} direction-${direction} source-${source} ${compactClass} ${
        data.focused ? 'focused' : ''
      } ${data.changed ? 'recently-changed' : ''}`}
    >
      <Handle id="target-left" type="target" position={Position.Left} />
      <Handle id="target-right" type="target" position={Position.Right} />
      <Handle id="target-top" type="target" position={Position.Top} />
      <Handle id="target-bottom" type="target" position={Position.Bottom} />

      <div className="mind-node-actions nodrag nopan">
        <button
          type="button"
          disabled={data.aiBusy}
          title="让 AI 围绕这个节点继续推演"
          aria-label={`让AI继续推演${node.title}`}
          onClick={(event) => {
            event.stopPropagation();
            data.onExpandWithAi(node.id);
          }}
        >
          继续想 ↗
        </button>
        {node.parentId ? (
          <button
            className="node-action-delete"
            type="button"
            title="删除这个不合理分支"
            aria-label={`删除${node.title}分支`}
            onClick={(event) => {
              event.stopPropagation();
              data.onDeleteBranch(node.id);
            }}
          >
            删除
          </button>
        ) : null}
      </div>

      <div className="mind-node-title">{node.title}</div>
      {node.content ? <div className="mind-node-content">{node.content}</div> : null}
      <div className="mind-node-meta">
        <span className="node-kind">
          {
            {
              topic: '主题',
              task: '行动',
              idea: '念头',
              note: '片段',
              question: '问题',
              risk: '顾虑',
              resource: '线索',
              decision: '判断',
            }[node.kind]
          }
        </span>
        {source === 'inference' ? (
          <span className="mind-node-source source-label-inference">AI 补充</span>
        ) : null}
        {data.inferenceCount > 0 ? (
          <button
            type="button"
            className="inference-toggle nodrag"
            onClick={(event) => {
              event.stopPropagation();
              data.onToggleInference(node.id);
            }}
          >
            {data.inferenceExpanded ? '收起AI推测' : `AI推测 ${data.inferenceCount} 条`}
          </button>
        ) : null}
        {data.childCount > 0 && (
          <button
            type="button"
            className="branch-toggle nodrag nopan"
            aria-label={`${data.collapsed ? '展开' : '收起'}${node.title}分支`}
            onClick={(event) => {
              event.stopPropagation();
              data.onToggleCollapse?.(node.id);
            }}
          >
            {data.collapsed ? `＋ ${data.childCount}` : '− 收起'}
          </button>
        )}
      </div>

      <Handle id="source-left" type="source" position={Position.Left} />
      <Handle id="source-right" type="source" position={Position.Right} />
      <Handle id="source-top" type="source" position={Position.Top} />
      <Handle id="source-bottom" type="source" position={Position.Bottom} />
    </div>
  );
}

function CanvasGroup({ data }: { data: { label: string } }) {
  return (
    <div className="mind-canvas-group">
      <div className="mind-canvas-group-label">{data.label}</div>
    </div>
  );
}

const nodeTypes: NodeTypes = {
  canvasNode: CanvasNode,
  canvasGroup: CanvasGroup,
};

function InitialViewport({
  nodeCount,
  hasSavedViewport,
}: {
  nodeCount: number;
  hasSavedViewport: boolean;
}) {
  const { fitView } = useReactFlow();
  const fittedRef = useRef(false);

  useEffect(() => {
    if (nodeCount === 0) {
      fittedRef.current = false;
      return;
    }
    if (hasSavedViewport || fittedRef.current) {
      return;
    }
    fittedRef.current = true;
    const frame = requestAnimationFrame(() => {
      void fitView({ padding: 0.24, duration: 250, maxZoom: 0.95 });
    });
    return () => cancelAnimationFrame(frame);
  }, [fitView, hasSavedViewport, nodeCount]);

  return null;
}

export function MindMapCanvas({
  mindMap,
  focusedNodeId,
  onFocusNodeChange,
  positionOverrides,
  onPositionChange,
  viewport,
  onViewportChange,
  expandedInferenceNodeIds,
  onToggleInference,
  changedNodeIds,
  onUpdateNode,
  onExpandWithAi,
  onDeleteBranch,
  fitRequest = 0,
  collapsedNodeIds = [],
  onToggleCollapse,
  aiBusy = false,
  onOverview,
  showAllRelations = false,
  onShowAllRelationsChange,
}: MindMapCanvasProps) {
  const { fitView, getViewport, setViewport } = useReactFlow();

  useEffect(() => {
    if (!viewport) {
      return;
    }
    const current = getViewport();
    const isDifferent =
      Math.abs(current.x - viewport.x) > 0.5 ||
      Math.abs(current.y - viewport.y) > 0.5 ||
      Math.abs(current.zoom - viewport.zoom) > 0.001;
    if (isDifferent) {
      void setViewport(viewport);
    }
  }, [getViewport, setViewport, viewport]);

  const rendered = useMemo(() => {
    const result = mindMapToReactFlow(
      mindMap,
      focusedNodeId,
      positionOverrides,
      expandedInferenceNodeIds,
      changedNodeIds,
      new Set(collapsedNodeIds),
    );
    const childCounts = new Map<string, number>();
    const collect = (node: MindMapNode) => {
      childCounts.set(node.id, node.children.length);
      node.children.forEach(collect);
    };
    if (mindMap) collect(mindMap.root);
    const related = new Set<string>(focusedNodeId ? [focusedNodeId] : []);
    for (const edge of result.graphEdges) {
      if (edge.source === focusedNodeId || edge.target === focusedNodeId) {
        related.add(edge.source);
        related.add(edge.target);
      }
    }
    result.nodes = result.nodes.map((node) =>
      node.type === 'canvasGroup'
        ? node
        : {
            ...node,
            style: { ...node.style, opacity: focusedNodeId && !related.has(node.id) ? 0.22 : 1 },
            data: {
              ...node.data,
              onToggleInference,
              onExpandWithAi,
              onDeleteBranch,
              childCount: childCounts.get(node.id) ?? 0,
              collapsed: collapsedNodeIds.includes(node.id),
              onToggleCollapse,
              aiBusy,
            },
          },
    );
    result.edges = result.edges.map((edge) => {
      const active = edge.source === focusedNodeId || edge.target === focusedNodeId;
      const relation = edge.id.startsWith('relation:');
      return {
        ...edge,
        label: relation && !showAllRelations && !active ? undefined : edge.label,
        style: {
          ...edge.style,
          opacity: focusedNodeId && !active ? 0.09 : relation ? 0.85 : 0.55,
          stroke: relation ? '#9a7652' : '#a9b9b0',
          strokeWidth: active ? 2.5 : relation ? 1.8 : 1.3,
        },
        zIndex: active ? 3 : 0,
      };
    });
    return result;
  }, [
    changedNodeIds,
    expandedInferenceNodeIds,
    focusedNodeId,
    mindMap,
    onDeleteBranch,
    onExpandWithAi,
    onToggleInference,
    positionOverrides,
    collapsedNodeIds,
    onToggleCollapse,
    aiBusy,
    showAllRelations,
  ]);

  const showEntireMap = useCallback(async () => {
    onFocusNodeChange(null);
    await fitView({ padding: 0.22, duration: 350, maxZoom: 0.95 });
    const nextViewport = getViewport();
    onViewportChange(nextViewport);
  }, [fitView, getViewport, onFocusNodeChange, onViewportChange]);

  const previousFitRequest = useRef(0);
  useEffect(() => {
    if (fitRequest !== previousFitRequest.current) {
      previousFitRequest.current = fitRequest;
      void showEntireMap();
    }
  }, [fitRequest, showEntireMap]);

  const clearFocus = () => {
    onFocusNodeChange(null);
  };

  return (
    <div className="canvas-shell">
      {mindMap && (
        <div className="canvas-toolbar">
          <span>{focusedNodeId ? '局部 · 相关念头已突出' : '全局 · 看见事情之间的联系'}</span>
          {mindMap.root.children.length > 0 && (
            <button type="button" onClick={onOverview}>
              {mindMap.root.children.every((node) => collapsedNodeIds.includes(node.id))
                ? '展开全图'
                : '只看主题'}
            </button>
          )}
          <button
            type="button"
            aria-pressed={showAllRelations}
            onClick={() => onShowAllRelationsChange?.(!showAllRelations)}
          >
            {showAllRelations ? '收起连线说明' : '显示连线说明'}
          </button>
          {focusedNodeId && (
            <button type="button" onClick={() => onFocusNodeChange(null)}>
              回到全图
            </button>
          )}
        </div>
      )}
      {rendered.nodes.length === 0 ? (
        <div className="canvas-empty">
          <div className="canvas-empty-kicker">A SPACE TO THINK</div>
          <div className="canvas-empty-title">开始整理你的想法</div>
          <div className="canvas-empty-copy">
            不必先想清楚。把散落的事情放在这里，
            <br />
            让联系浮现，让下一步变得清楚。
          </div>
          <div className="canvas-empty-steps">
            <span>01 随意表达</span>
            <span>02 找到联系</span>
            <span>03 向前一步</span>
          </div>
        </div>
      ) : null}

      <button className="fit-view-button" type="button" onClick={() => void showEntireMap()}>
        显示全图
      </button>

      <aside className="source-legend" aria-label="节点颜色说明">
        <div className="source-legend-item">
          <span className="source-legend-swatch source-legend-user" />
          <span>绿 原文</span>
        </div>
        <div className="source-legend-item">
          <span className="source-legend-swatch source-legend-summary" />
          <span>蓝 归纳</span>
        </div>
        <div className="source-legend-item">
          <span className="source-legend-swatch source-legend-inference" />
          <span>紫 推测</span>
        </div>
        <div className="source-legend-item">
          <span className="relation-legend-arrow">→</span>
          <span>联系 · 虚线待验证</span>
        </div>
      </aside>

      <ReactFlow
        nodes={rendered.nodes}
        edges={rendered.edges}
        nodeTypes={nodeTypes}
        defaultViewport={viewport ?? { x: 0, y: 0, zoom: 1 }}
        onMoveEnd={(_event, nextViewport) => onViewportChange(nextViewport)}
        onNodeDragStop={(_event, node) => {
          if (node.type === 'canvasGroup') {
            return;
          }
          onPositionChange(node.id, node.position);
          const graphNode = (node.data as unknown as CanvasNodeData).node;
          if (!graphNode.parentId) {
            return;
          }
          const parent = rendered.nodes.find((candidate) => candidate.id === graphNode.parentId);
          if (!parent) {
            return;
          }
          const deltaX = node.position.x - parent.position.x;
          const deltaY = node.position.y - parent.position.y;
          const layoutDirection =
            Math.abs(deltaX) >= Math.abs(deltaY)
              ? deltaX >= 0
                ? 'right'
                : 'left'
              : deltaY >= 0
                ? 'down'
                : 'up';
          onUpdateNode(graphNode.id, { layoutDirection });
        }}
        onNodeClick={(_event, node) => onFocusNodeChange(node.id)}
        onPaneClick={clearFocus}
        zoomOnScroll
        panOnDrag
        zoomOnPinch
        zoomOnDoubleClick={false}
        panOnScroll={false}
        nodesDraggable
        elementsSelectable
        defaultEdgeOptions={{ type: 'bezier' }}
        minZoom={0.18}
        maxZoom={2.2}
        proOptions={{ hideAttribution: true }}
      >
        <InitialViewport nodeCount={rendered.nodes.length} hasSavedViewport={Boolean(viewport)} />
        <Background gap={28} size={1} color="#d7dde8" />
      </ReactFlow>
    </div>
  );
}
