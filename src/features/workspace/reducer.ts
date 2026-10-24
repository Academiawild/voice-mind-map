import {
  summarizeMindMapCommands,
  type MindMapChangeResponse,
  type MindMapDocument,
} from '../../../shared/mind-map';
import type { RuntimeStatus } from '../../../shared/runtime';
import { canTransitionCapturePhase } from '../capture/capture-machine';
import type {
  CapturePhase,
  SavedInput,
  WorkspacePersistence,
  WorkspaceSnapshot,
  WorkspaceState,
  WorkspaceViewport,
} from './model';

const HISTORY_LIMIT = 30;

export function createEmptyWorkspaceState(
  snapshot?: Partial<WorkspacePersistence>,
): WorkspaceState {
  return {
    document: snapshot?.document ?? null,
    positions: snapshot?.positions ?? {},
    viewport: snapshot?.viewport ?? null,
    expandedInferenceNodeIds: snapshot?.expandedInferenceNodeIds ?? [],
    navigation: snapshot?.navigation ?? [],
    savedInputs: snapshot?.savedInputs ?? [],
    acknowledgedCaptureIds: snapshot?.acknowledgedCaptureIds ?? [],
    notice: null,
    captureSession: {
      mode: 'text',
      phase: 'idle',
      draft: snapshot?.draft ?? '',
      partialTranscript: '',
      captureId: null,
      error: null,
    },
    selection: { nodeId: null },
    activity: null,
    history: { past: [], future: [] },
    serviceStatus: null,
    feedback: [],
    request: { generation: 0, inFlight: false, baseRevision: null },
    pendingCaptures: [],
  };
}

export function workspaceSnapshot(state: WorkspaceState): WorkspaceSnapshot {
  return {
    document: state.document,
    positions: state.positions,
    viewport: state.viewport,
    expandedInferenceNodeIds: state.expandedInferenceNodeIds,
    navigation: state.navigation,
  };
}

function withCommittedSnapshot(state: WorkspaceState, next: WorkspaceSnapshot): WorkspaceState {
  return {
    ...state,
    ...next,
    history: {
      past: [...state.history.past, workspaceSnapshot(state)].slice(-HISTORY_LIMIT),
      future: [],
    },
  };
}

export type WorkspaceAction =
  | { type: 'input/save'; input: SavedInput }
  | { type: 'notice/set'; message: string | null }
  | { type: 'capture/acknowledged'; id: string }
  | { type: 'request/cancel'; generation: number }
  | { type: 'capture/draft'; draft: string }
  | {
      type: 'capture/phase';
      phase: CapturePhase;
      mode?: 'text' | 'realtime' | 'file';
      error?: string | null;
    }
  | { type: 'capture/partial'; transcript: string }
  | { type: 'capture/recognized'; captureId: string; transcript: string }
  | { type: 'selection/set'; nodeId: string | null }
  | { type: 'feedback/add'; message: string }
  | { type: 'view/position'; nodeId: string; position: { x: number; y: number }; commit?: boolean }
  | { type: 'view/viewport'; viewport: WorkspaceViewport }
  | { type: 'view/toggleInference'; nodeId: string }
  | { type: 'request/start'; generation: number; baseRevision: number }
  | { type: 'request/fail'; generation: number; message: string }
  | {
      type: 'request/succeed';
      generation: number;
      baseRevision: number;
      response: MindMapChangeResponse;
      submittedDraft?: string;
    }
  | {
      type: 'document/commit';
      document: MindMapDocument;
      summary: string;
      changedNodeIds: string[];
    }
  | { type: 'history/undo' }
  | { type: 'history/redo' }
  | { type: 'runtime/status'; status: RuntimeStatus | null }
  | { type: 'captures/pending'; captures: WorkspaceState['pendingCaptures'] };

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  if (action.type === 'input/save')
    return { ...state, savedInputs: [...state.savedInputs, action.input] };
  if (action.type === 'notice/set') return { ...state, notice: action.message };
  if (action.type === 'capture/acknowledged')
    return {
      ...state,
      acknowledgedCaptureIds: [...new Set([...state.acknowledgedCaptureIds, action.id])],
    };
  if (action.type === 'request/cancel')
    return {
      ...state,
      request: { generation: action.generation, inFlight: false, baseRevision: null },
      captureSession: { ...state.captureSession, phase: 'idle', error: null },
    };
  if (action.type === 'capture/draft') {
    return {
      ...state,
      captureSession: { ...state.captureSession, draft: action.draft, error: null },
    };
  }
  if (action.type === 'capture/phase') {
    if (!canTransitionCapturePhase(state.captureSession.phase, action.phase)) return state;
    return {
      ...state,
      captureSession: {
        ...state.captureSession,
        phase: action.phase,
        mode: action.mode ?? state.captureSession.mode,
        error: action.error === undefined ? state.captureSession.error : action.error,
      },
    };
  }
  if (action.type === 'capture/partial') {
    return {
      ...state,
      captureSession: { ...state.captureSession, partialTranscript: action.transcript },
    };
  }
  if (action.type === 'capture/recognized') {
    if (!canTransitionCapturePhase(state.captureSession.phase, 'organizing')) return state;
    return {
      ...state,
      captureSession: {
        ...state.captureSession,
        phase: 'organizing',
        draft: state.captureSession.draft.trim() ? state.captureSession.draft : action.transcript,
        partialTranscript: '',
        captureId: action.captureId,
        error: null,
      },
    };
  }
  if (action.type === 'selection/set') return { ...state, selection: { nodeId: action.nodeId } };
  if (action.type === 'feedback/add') {
    const message = action.message.trim();
    if (!message) return state;
    return { ...state, feedback: [...state.feedback, message].slice(-30) };
  }
  if (action.type === 'view/position') {
    const next = {
      ...workspaceSnapshot(state),
      positions: { ...state.positions, [action.nodeId]: action.position },
    };
    if (!action.commit) return { ...state, ...next };
    return {
      ...withCommittedSnapshot(state, next),
      feedback: [
        ...state.feedback,
        `高权重：用户手动固定节点 ${action.nodeId} 的画布位置为 (${Math.round(action.position.x)}, ${Math.round(action.position.y)})。`,
      ].slice(-30),
    };
  }
  if (action.type === 'view/viewport') return { ...state, viewport: action.viewport };
  if (action.type === 'view/toggleInference') {
    const expanded = new Set(state.expandedInferenceNodeIds);
    if (expanded.has(action.nodeId)) expanded.delete(action.nodeId);
    else expanded.add(action.nodeId);
    return { ...state, expandedInferenceNodeIds: [...expanded] };
  }
  if (action.type === 'request/start') {
    if (!canTransitionCapturePhase(state.captureSession.phase, 'organizing')) return state;
    return {
      ...state,
      request: { generation: action.generation, inFlight: true, baseRevision: action.baseRevision },
      captureSession: { ...state.captureSession, phase: 'organizing', error: null },
    };
  }
  if (action.type === 'request/fail') {
    if (action.generation !== state.request.generation) return state;
    if (!canTransitionCapturePhase(state.captureSession.phase, 'failed')) return state;
    return {
      ...state,
      request: { ...state.request, inFlight: false },
      captureSession: { ...state.captureSession, phase: 'failed', error: action.message },
    };
  }
  if (action.type === 'request/succeed') {
    const currentRevision = state.document?.revision ?? 0;
    if (
      action.generation !== state.request.generation ||
      currentRevision !== action.baseRevision ||
      action.response.changeSet.baseRevision !== action.baseRevision
    ) {
      return state;
    }
    if (!canTransitionCapturePhase(state.captureSession.phase, 'completed')) return state;
    const counts = summarizeMindMapCommands(action.response.appliedCommands);
    const next = withCommittedSnapshot(state, {
      ...workspaceSnapshot(state),
      document: action.response.document,
      navigation: action.response.changeSet.navigation ?? [],
    });
    return {
      ...next,
      request: { ...state.request, inFlight: false },
      captureSession: {
        ...state.captureSession,
        phase: 'completed',
        draft:
          action.submittedDraft === undefined ||
          state.captureSession.draft === action.submittedDraft
            ? ''
            : state.captureSession.draft,
        partialTranscript: '',
        captureId: null,
        error: null,
      },
      activity: {
        summary: action.response.changeSet.summary,
        counts,
        rejectedCommands: action.response.rejectedCommands,
        changedNodeIds: counts.changedNodeIds,
        occurredAt: new Date().toISOString(),
      },
    };
  }
  if (action.type === 'document/commit') {
    const next = withCommittedSnapshot(state, {
      ...workspaceSnapshot(state),
      document: action.document,
    });
    return {
      ...next,
      request: { ...state.request, inFlight: false },
      captureSession:
        state.captureSession.phase === 'organizing'
          ? { ...state.captureSession, phase: 'idle' }
          : state.captureSession,
      activity: {
        summary: action.summary,
        counts: {
          added: 0,
          updated: 1,
          moved: 0,
          deleted: 0,
          relations: 0,
          groups: 0,
          replaced: false,
          changedNodeIds: action.changedNodeIds,
        },
        rejectedCommands: [],
        changedNodeIds: action.changedNodeIds,
        occurredAt: new Date().toISOString(),
      },
    };
  }
  if (action.type === 'history/undo') {
    const previous = state.history.past.at(-1);
    if (!previous) return state;
    return {
      ...state,
      ...previous,
      history: {
        past: state.history.past.slice(0, -1),
        future: [workspaceSnapshot(state), ...state.history.future].slice(0, HISTORY_LIMIT),
      },
      request: { generation: state.request.generation + 1, inFlight: false, baseRevision: null },
      viewport: state.viewport,
      captureSession:
        state.captureSession.phase === 'organizing'
          ? { ...state.captureSession, phase: 'idle' }
          : state.captureSession,
      activity: null,
    };
  }
  if (action.type === 'history/redo') {
    const next = state.history.future[0];
    if (!next) return state;
    return {
      ...state,
      ...next,
      history: {
        past: [...state.history.past, workspaceSnapshot(state)].slice(-HISTORY_LIMIT),
        future: state.history.future.slice(1),
      },
      request: { generation: state.request.generation + 1, inFlight: false, baseRevision: null },
      viewport: state.viewport,
      captureSession:
        state.captureSession.phase === 'organizing'
          ? { ...state.captureSession, phase: 'idle' }
          : state.captureSession,
      activity: null,
    };
  }
  if (action.type === 'runtime/status') return { ...state, serviceStatus: action.status };
  if (action.type === 'captures/pending') return { ...state, pendingCaptures: action.captures };
  return state;
}
