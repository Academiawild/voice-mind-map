import { ReactFlowProvider } from '@xyflow/react';
import { type DragEvent, useMemo, useState } from 'react';
import type { RecognizedCaptureRecord } from '../shared/capture';
import { findMindMapNodeById, type MindMapNodePatch } from '../shared/mind-map';
import { MindMapCanvas } from './features/mind-map/mind-map-canvas';
import { ThinkingDesk } from './features/mind-map/thinking-desk';
import { useThinkingDeskMemory } from './features/mind-map/thinking-desk-memory';
import { THINKING_LENSES } from './features/mind-map/thinking-tools';
import { CaptureBar } from './features/capture/capture-bar';
import { ActivityPanel } from './features/mind-map/activity-panel';
import { downloadMindMapFile } from './features/mind-map/export';
import { useWorkspaceController } from './features/workspace/use-workspace-controller';
import { WorkspaceHeader } from './features/workspace/workspace-header';

const AUDIO_EXTENSION = /\.(webm|wav|mp3|m4a|aac|ogg|oga|flac|mp4|3gp|3g2)$/i;

function isAudioFile(file: File) {
  return file.type.startsWith('audio/') || AUDIO_EXTENSION.test(file.name);
}

function App() {
  const workspace = useWorkspaceController();
  const { state, dispatch } = workspace;
  const [fitRequest, setFitRequest] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'desk' | 'map'>('desk');
  const deskMemory = useThinkingDeskMemory();
  const [showAllRelations, setShowAllRelations] = useState(false);
  const focusedNode = findMindMapNodeById(state.document, state.selection.nodeId);
  const operationBusy =
    state.request.inFlight || !['idle', 'completed', 'failed'].includes(state.captureSession.phase);
  const focusNode = (nodeId: string | null) => {
    // An explicit navigation selection reveals its path without moving the viewport.
    if (nodeId && state.document) {
      const reveal = (
        node: NonNullable<typeof state.document>['root'],
        ancestors: string[],
      ): string[] | null => {
        if (node.id === nodeId) return ancestors;
        for (const child of node.children) {
          const found = reveal(child, [...ancestors, node.id]);
          if (found) return found;
        }
        return null;
      };
      const path = reveal(state.document.root, []) ?? [];
      setCollapsedNodeIds((current) => current.filter((id) => !path.includes(id)));
      for (const id of path)
        if (!state.expandedInferenceNodeIds.includes(id))
          dispatch({ type: 'view/toggleInference', nodeId: id });
    }
    dispatch({ type: 'selection/set', nodeId });
  };
  const compose = (text: string) => {
    dispatch({
      type: 'capture/draft',
      draft: state.captureSession.draft.trim() ? `${state.captureSession.draft}\n${text}` : text,
    });
    setFocusRequest((value) => value + 1);
  };
  const explore = (input: string, nodeId: string | null) => {
    if (!operationBusy)
      void workspace.organize(input, { intent: 'manual', selectedNodeId: nodeId, generated: true });
  };
  const expand = (nodeId: string, title: string) =>
    explore(
      `围绕“${title}”继续思考：寻找跨分支联系、挑战一个具体前提，并给一个能推进理解的下一步。保留原有意思，新增解释标为推测。`,
      nodeId,
    );
  const [shutdownState, setShutdownState] = useState<{
    phase: 'idle' | 'closing' | 'closed' | 'failed';
    message?: string;
  }>({ phase: 'idle' });
  const expanded = useMemo(
    () => new Set(state.expandedInferenceNodeIds),
    [state.expandedInferenceNodeIds],
  );
  const changed = useMemo(
    () => new Set(state.activity?.changedNodeIds ?? []),
    [state.activity?.changedNodeIds],
  );

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (operationBusy) return;
    const file = Array.from(event.dataTransfer.files).find(isAudioFile);
    if (file) void workspace.importAudio(file);
    else
      dispatch({
        type: 'capture/phase',
        phase: 'failed',
        mode: 'file',
        error: '请拖入受支持的音频文件。',
      });
  };

  const recognized = (capture: RecognizedCaptureRecord) => {
    dispatch({ type: 'capture/recognized', captureId: capture.id, transcript: capture.transcript });
    void workspace.organize(capture.transcript, { intent: 'batch', captureId: capture.id });
  };

  const handleShutdown = async () => {
    if (shutdownState.phase === 'closing' || shutdownState.phase === 'closed') return;
    setShutdownState({ phase: 'closing' });
    try {
      await workspace.shutdown();
      setShutdownState({ phase: 'closed' });
    } catch (error) {
      setShutdownState({
        phase: 'failed',
        message: error instanceof Error ? error.message : '关闭失败，请重试。',
      });
    }
  };

  if (shutdownState.phase === 'closed') {
    return (
      <main className="runtime-closed" aria-live="polite">
        <div>
          <span aria-hidden="true">✓</span>
          <h1>本次运行已关闭</h1>
          <p>本地服务和语音进程已经停止，现在可以关闭这个浏览器标签页。</p>
          <small>再次使用时，双击项目中的 start.command。</small>
        </div>
      </main>
    );
  }

  return (
    <ReactFlowProvider>
      <div
        className="workspace-shell"
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={handleDrop}
      >
        <WorkspaceHeader
          state={state}
          onUndo={workspace.undo}
          onRedo={workspace.redo}
          onFit={() => {
            setViewMode('map');
            setFitRequest((value) => value + 1);
          }}
          onExportJson={() => state.document && downloadMindMapFile(state.document, 'json')}
          onExportMarkdown={() => state.document && downloadMindMapFile(state.document, 'markdown')}
          onShutdown={() => void handleShutdown()}
        />

        {shutdownState.phase === 'closing' ? (
          <div className="workspace-banner" role="status">
            正在关闭本次运行…
          </div>
        ) : null}

        {shutdownState.phase === 'failed' ? (
          <div className="workspace-banner is-error" role="alert">
            {shutdownState.message}
          </div>
        ) : null}

        {state.notice && (
          <div className="workspace-banner" role="status">
            {state.notice}
            <button type="button" onClick={() => dispatch({ type: 'notice/set', message: null })}>
              知道了
            </button>
          </div>
        )}

        {state.serviceStatus && !state.serviceStatus.ai.ready ? (
          <div className="workspace-banner">
            本地模型尚未就绪；请启动 Ollama 并确认模型 <code>{state.serviceStatus.ai.model}</code>{' '}
            已安装。
          </div>
        ) : null}

        <main className="workspace-main">
          <div className="workspace-canvas">
            <div className="thinking-toolbar">
              <div className="thinking-view-switch" role="group" aria-label="阅读视角">
                <button
                  type="button"
                  aria-pressed={viewMode === 'desk'}
                  onClick={() => {
                    setViewMode('desk');
                    setFitRequest(0);
                  }}
                >
                  思路
                </button>
                <button
                  type="button"
                  aria-pressed={viewMode === 'map'}
                  onClick={() => setViewMode('map')}
                >
                  导图
                </button>
              </div>
              {state.document && (
                <div
                  className="thinking-lenses"
                  role="group"
                  aria-label={focusedNode ? `围绕${focusedNode.title}思考` : '全图思考工具'}
                >
                  {THINKING_LENSES.map((lens) => (
                    <button
                      type="button"
                      key={lens.id}
                      title={`${focusedNode ? `围绕「${focusedNode.title}」：` : ''}${lens.hint}`}
                      disabled={operationBusy || !state.serviceStatus?.ai.ready}
                      onClick={() => explore(lens.prompt, focusedNode?.id ?? null)}
                    >
                      {lens.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {viewMode === 'desk' ? (
              <ThinkingDesk
                memory={deskMemory}
                document={state.document}
                navigation={state.navigation}
                selectedNodeId={state.selection.nodeId}
                busy={operationBusy || !state.serviceStatus?.ai.ready}
                onFocus={focusNode}
                onCompose={compose}
                onExplore={explore}
              />
            ) : (
              <MindMapCanvas
                showAllRelations={showAllRelations}
                onShowAllRelationsChange={setShowAllRelations}
                mindMap={state.document}
                focusedNodeId={state.selection.nodeId}
                onFocusNodeChange={focusNode}
                collapsedNodeIds={collapsedNodeIds}
                onOverview={() => {
                  const branches = state.document?.root.children.map((node) => node.id) ?? [];
                  const alreadyCollapsed =
                    branches.length > 0 && branches.every((id) => collapsedNodeIds.includes(id));
                  setCollapsedNodeIds(alreadyCollapsed ? [] : branches);
                  focusNode(null);
                  setFitRequest((value) => value + 1);
                }}
                onToggleCollapse={(nodeId) =>
                  setCollapsedNodeIds((ids) =>
                    ids.includes(nodeId) ? ids.filter((id) => id !== nodeId) : [...ids, nodeId],
                  )
                }
                aiBusy={operationBusy || !state.serviceStatus?.ai.ready}
                positionOverrides={state.positions}
                onPositionChange={(nodeId, position) =>
                  dispatch({ type: 'view/position', nodeId, position, commit: true })
                }
                viewport={state.viewport}
                onViewportChange={(viewport) => dispatch({ type: 'view/viewport', viewport })}
                expandedInferenceNodeIds={expanded}
                onToggleInference={(nodeId) => dispatch({ type: 'view/toggleInference', nodeId })}
                changedNodeIds={changed}
                onUpdateNode={(nodeId, patch) =>
                  workspace.updateNode(nodeId, patch as MindMapNodePatch)
                }
                onExpandWithAi={(nodeId) => {
                  const node = findMindMapNodeById(state.document, nodeId);
                  if (node) expand(nodeId, node.title);
                }}
                onDeleteBranch={workspace.deleteNode}
                fitRequest={fitRequest}
              />
            )}
          </div>

          <ActivityPanel
            state={state}
            showEntries={viewMode === 'map'}
            onUpdateNode={workspace.updateNode}
            onSetNodeStatus={workspace.setNodeStatus}
            onDeleteNode={(nodeId) => {
              workspace.deleteNode(nodeId);
              dispatch({ type: 'selection/set', nodeId: null });
            }}
            onExpand={expand}
            onFocus={focusNode}
            onExplore={explore}
            onCompose={compose}
            onToggleInference={(nodeId) => dispatch({ type: 'view/toggleInference', nodeId })}
            onUndo={workspace.undo}
            onResumeCapture={workspace.resumeCapture}
          />
        </main>

        <CaptureBar
          session={state.captureSession}
          focusedTitle={focusedNode?.title}
          focusRequest={focusRequest}
          onClearFocus={() => focusNode(null)}
          organizing={state.request.inFlight}
          onCancel={workspace.cancel}
          canRetry={workspace.canRetry}
          onRetry={() => void workspace.retry()}
          aiReady={Boolean(state.serviceStatus?.ai.ready)}
          httpReady={Boolean(state.serviceStatus?.transcription.http.ready)}
          realtimeReady={Boolean(state.serviceStatus?.transcription.realtime.ready)}
          busy={
            state.request.inFlight ||
            !['idle', 'completed', 'failed'].includes(state.captureSession.phase)
          }
          onDraftChange={(draft) => dispatch({ type: 'capture/draft', draft })}
          onPhase={(phase, error) =>
            dispatch({ type: 'capture/phase', phase, mode: 'realtime', error: error ?? null })
          }
          onPartial={(transcript) => dispatch({ type: 'capture/partial', transcript })}
          onRecognized={recognized}
          onOrganize={() =>
            void workspace.organize(state.captureSession.draft, { intent: 'manual' })
          }
          onFile={(file) => void workspace.importAudio(file)}
        />

        {dragging ? (
          <div className="workspace-drop-overlay">
            <div>
              <strong>松开以转写录音</strong>
              <span>完整文件会走本地 HTTP 转写</span>
            </div>
          </div>
        ) : null}
      </div>
    </ReactFlowProvider>
  );
}

export default App;
