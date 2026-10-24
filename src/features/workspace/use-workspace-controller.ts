import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  MindMapChangeRequestSchema,
  MindMapDocumentSchema,
  applyMindMapChangeSet,
  type MindMapNodePatch,
  type MindMapIntent,
} from '../../../shared/mind-map';
import {
  getPendingCaptures,
  getRuntimeStatus,
  markCaptureOrganized,
  requestMindMapChange,
  shutdownRuntime,
  transcribeFile,
} from '../runtime/api-client';
import { createEmptyWorkspaceState, workspaceReducer } from './reducer';
import { loadWorkspaceSnapshot, saveWorkspaceSnapshot } from './storage';

type OrganizeOptions = {
  intent?: MindMapIntent;
  captureId?: string;
  selectedNodeId?: string | null;
  generated?: boolean;
};
type OrganizationAttempt = {
  rawInput: string;
  options: OrganizeOptions;
  inputId: string;
  submittedDraft: string;
};

export function useWorkspaceController() {
  const [state, dispatch] = useReducer(workspaceReducer, undefined, () =>
    createEmptyWorkspaceState(loadWorkspaceSnapshot()),
  );
  const stateRef = useRef(state);
  const generationRef = useRef(state.request.generation);
  const aiAbortRef = useRef<AbortController | null>(null);
  const fileAbortRef = useRef<AbortController | null>(null);
  const acknowledgedRef = useRef(new Set(state.acknowledgedCaptureIds));
  const retryOrganization = useRef<OrganizationAttempt | null>(null);
  const retryAudio = useRef<File | null>(null);
  const [hasRetry, setHasRetry] = useState(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const saved = saveWorkspaceSnapshot({
      document: state.document,
      positions: state.positions,
      viewport: state.viewport,
      expandedInferenceNodeIds: state.expandedInferenceNodeIds,
      navigation: state.navigation,
      savedInputs: state.savedInputs,
      draft: state.captureSession.draft,
      acknowledgedCaptureIds: state.acknowledgedCaptureIds,
    });
    if (saved === false)
      dispatch({
        type: 'notice/set',
        message: '浏览器存储未成功，请先复制原话或导出导图，避免刷新后丢失。',
      });
  }, [
    state.document,
    state.expandedInferenceNodeIds,
    state.positions,
    state.viewport,
    state.navigation,
    state.savedInputs,
    state.captureSession.draft,
    state.acknowledgedCaptureIds,
  ]);

  useEffect(() => {
    let disposed = false;
    let timer: number | null = null;
    const poll = async () => {
      try {
        const status = await getRuntimeStatus();
        if (!disposed) dispatch({ type: 'runtime/status', status });
      } catch {
        if (!disposed) dispatch({ type: 'runtime/status', status: null });
      } finally {
        if (!disposed) timer = window.setTimeout(poll, 3000);
      }
    };
    void poll();
    return () => {
      disposed = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  const refreshPendingCaptures = useCallback(async () => {
    try {
      const captures = await getPendingCaptures();
      for (const capture of captures) {
        if (acknowledgedRef.current.has(capture.id))
          await markCaptureOrganized(capture.id).catch(() => undefined);
      }
      dispatch({
        type: 'captures/pending',
        captures: captures.filter((capture) => !acknowledgedRef.current.has(capture.id)),
      });
    } catch {
      // Status UI already communicates backend availability.
    }
  }, []);

  const runtimeId = state.serviceStatus?.runtimeId;
  useEffect(() => {
    if (runtimeId) void refreshPendingCaptures();
  }, [runtimeId, refreshPendingCaptures]);

  const invalidate = useCallback(() => {
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
    generationRef.current += 1;
    retryOrganization.current = null;
    retryAudio.current = null;
    setHasRetry(false);
  }, []);

  const organize = useCallback(
    async (rawInput: string, options?: OrganizeOptions, retryAttempt?: OrganizationAttempt) => {
      const input = rawInput.trim();
      const current = stateRef.current;
      if (options?.captureId && acknowledgedRef.current.has(options.captureId)) {
        await refreshPendingCaptures();
        return;
      }
      if (!input) return;
      const attempt = retryAttempt ?? {
        rawInput,
        options: {
          ...options,
          selectedNodeId:
            options?.selectedNodeId === undefined
              ? current.selection.nodeId
              : options.selectedNodeId,
        },
        inputId: crypto.randomUUID(),
        submittedDraft: options?.generated
          ? ''
          : options?.captureId
            ? rawInput
            : current.captureSession.draft,
      };
      retryOrganization.current = attempt;
      setHasRetry(true);
      if (
        !options?.generated &&
        !current.savedInputs.some((entry) => entry.id === attempt.inputId) &&
        !(
          options?.captureId &&
          current.savedInputs.some((entry) => entry.captureId === options.captureId)
        )
      ) {
        dispatch({
          type: 'input/save',
          input: {
            id: attempt.inputId,
            text: rawInput,
            createdAt: new Date().toISOString(),
            ...(options?.captureId ? { captureId: options.captureId } : {}),
          },
        });
      }
      if (!current.serviceStatus?.ai.ready) {
        dispatch({
          type: 'capture/phase',
          phase: 'failed',
          error: '原话已保留。本地模型尚未就绪，稍后可以继续整理。',
        });
        void refreshPendingCaptures();
        return;
      }
      aiAbortRef.current?.abort();
      const abort = new AbortController();
      aiAbortRef.current = abort;
      const generation = ++generationRef.current;
      const baseRevision = current.document?.revision ?? 0;
      dispatch({ type: 'request/start', generation, baseRevision });
      try {
        const response = await requestMindMapChange(
          MindMapChangeRequestSchema.parse({
            input,
            intent: options?.intent ?? 'manual',
            document: current.document,
            selectedNodeId: attempt.options.selectedNodeId,
            layoutPreferences: current.positions,
            feedback: current.feedback.slice(-10),
            captureId: options?.captureId,
          }),
          abort.signal,
        );
        if (
          generationRef.current !== generation ||
          (stateRef.current.document?.revision ?? 0) !== baseRevision
        )
          return;
        if (response.changeSet.baseRevision !== baseRevision) {
          throw new Error('这次整理与当前导图版本不一致，结果未应用。原话已保留，可以重试。');
        }
        dispatch({
          type: 'request/succeed',
          generation,
          baseRevision,
          response,
          submittedDraft: attempt.submittedDraft,
        });
        retryOrganization.current = null;
        setHasRetry(false);
        if (options?.captureId) {
          acknowledgedRef.current.add(options.captureId);
          dispatch({ type: 'capture/acknowledged', id: options.captureId });
          await markCaptureOrganized(options.captureId).catch(() => {
            dispatch({
              type: 'notice/set',
              message: '导图已更新。录音状态稍后同步，无需重复整理。',
            });
          });
          await refreshPendingCaptures();
        }
      } catch (error) {
        if (abort.signal.aborted) return;
        dispatch({
          type: 'request/fail',
          generation,
          message: error instanceof Error ? error.message : 'AI 整理失败。',
        });
      } finally {
        if (aiAbortRef.current === abort) aiAbortRef.current = null;
      }
    },
    [refreshPendingCaptures],
  );

  const importAudio = useCallback(
    async (file: File) => {
      retryOrganization.current = null;
      retryAudio.current = file;
      setHasRetry(true);
      fileAbortRef.current?.abort();
      const abort = new AbortController();
      fileAbortRef.current = abort;
      dispatch({ type: 'capture/phase', phase: 'transcribing', mode: 'file', error: null });
      try {
        const { capture } = await transcribeFile(file, file.name, abort.signal);
        retryAudio.current = null;
        dispatch({
          type: 'capture/recognized',
          captureId: capture.id,
          transcript: capture.transcript,
        });
        await organize(capture.transcript, { intent: 'batch', captureId: capture.id });
      } catch (error) {
        if (!abort.signal.aborted) {
          dispatch({
            type: 'capture/phase',
            phase: 'failed',
            mode: 'file',
            error: error instanceof Error ? error.message : '音频导入失败。',
          });
        }
      }
    },
    [organize],
  );

  const commitLocal = useCallback(
    (commands: Parameters<typeof applyMindMapChangeSet>[1]['commands'], summary: string) => {
      const current = stateRef.current.document;
      if (!current) return;
      invalidate();
      const result = applyMindMapChangeSet(
        current,
        { baseRevision: current.revision, summary, commands },
        { allowReplace: false },
      );
      if (result.document && result.appliedCommands.length) {
        dispatch({
          type: 'document/commit',
          document: MindMapDocumentSchema.parse(result.document),
          summary,
          changedNodeIds: result.appliedCommands.flatMap((command) =>
            'nodeId' in command
              ? [command.nodeId]
              : command.type === 'addNode'
                ? [command.node.id]
                : [],
          ),
        });
      }
    },
    [invalidate],
  );

  const updateNode = useCallback(
    (nodeId: string, patch: MindMapNodePatch) => {
      const semanticEdit =
        patch.title !== undefined ||
        patch.content !== undefined ||
        patch.kind !== undefined ||
        patch.status !== undefined;
      if (semanticEdit) {
        dispatch({ type: 'feedback/add', message: `高权重：用户手动修改了节点 ${nodeId}。` });
      }
      commitLocal(
        [
          {
            type: 'updateNode',
            nodeId,
            patch: semanticEdit ? { ...patch, source: 'user' } : patch,
          },
        ],
        semanticEdit ? '已保存节点修改。' : '已保存画布布局。',
      );
    },
    [commitLocal],
  );
  const deleteNode = useCallback(
    (nodeId: string) => {
      dispatch({
        type: 'feedback/add',
        message: `高权重：用户明确删除了节点 ${nodeId} 及其分支。`,
      });
      commitLocal([{ type: 'deleteNode', nodeId }], '已删除分支。');
    },
    [commitLocal],
  );

  const setNodeStatus = useCallback(
    (nodeId: string, status: NonNullable<MindMapNodePatch['status']>) => {
      dispatch({
        type: 'feedback/add',
        message: `用户将节点 ${nodeId} 标为 ${status}；保留此安排，done/later 不作为当前首选。`,
      });
      // A decision to pause/finish a thought does not endorse its AI-authored content.
      commitLocal(
        [{ type: 'updateNode', nodeId, patch: { status } }],
        status === 'done'
          ? '这个念头已理清。'
          : status === 'later'
            ? '已先放一放。'
            : '已放回眼前。',
      );
    },
    [commitLocal],
  );

  const undo = useCallback(() => {
    invalidate();
    dispatch({ type: 'history/undo' });
  }, [invalidate]);
  const redo = useCallback(() => {
    invalidate();
    dispatch({ type: 'history/redo' });
  }, [invalidate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditing =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      if (isEditing || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [redo, undo]);

  useEffect(
    () => () => {
      aiAbortRef.current?.abort();
      fileAbortRef.current?.abort();
    },
    [],
  );

  return {
    state,
    dispatch,
    organize,
    canRetry: state.captureSession.phase === 'failed' && hasRetry,
    retry: async () => {
      const current = stateRef.current;
      if (current.request.inFlight || current.captureSession.phase !== 'failed') return;
      const attempt = retryOrganization.current;
      if (attempt) await organize(attempt.rawInput, attempt.options, attempt);
      else if (retryAudio.current) await importAudio(retryAudio.current);
    },
    importAudio,
    updateNode,
    setNodeStatus,
    deleteNode,
    undo,
    redo,
    cancel: () => {
      invalidate();
      dispatch({ type: 'request/cancel', generation: generationRef.current });
    },
    resumeCapture: (id: string, transcript: string) =>
      organize(transcript, { intent: 'batch', captureId: id }),
    shutdown: () => {
      const token = stateRef.current.serviceStatus?.shutdownToken;
      return token ? shutdownRuntime(token) : Promise.resolve();
    },
  };
}
