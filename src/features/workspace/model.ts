import type { CaptureRecord } from '../../../shared/capture';
import type {
  MindMapChangeSummary,
  MindMapDocument,
  MindMapRejectedCommand,
  ThinkingEntry,
} from '../../../shared/mind-map';
import type { RuntimeStatus } from '../../../shared/runtime';

export type WorkspacePosition = { x: number; y: number };
export type WorkspaceViewport = { x: number; y: number; zoom: number };

export type WorkspaceSnapshot = {
  document: MindMapDocument | null;
  positions: Record<string, WorkspacePosition>;
  viewport: WorkspaceViewport | null;
  expandedInferenceNodeIds: string[];
  navigation?: ThinkingEntry[];
};

export type SavedInput = { id: string; text: string; createdAt: string; captureId?: string };
export type WorkspacePersistence = WorkspaceSnapshot & {
  savedInputs?: SavedInput[];
  draft?: string;
  acknowledgedCaptureIds?: string[];
};

export type CapturePhase =
  | 'idle'
  | 'requesting'
  | 'recording'
  | 'finalizing'
  | 'transcribing'
  | 'archiving'
  | 'organizing'
  | 'completed'
  | 'failed';

export type CaptureSession = {
  mode: 'text' | 'realtime' | 'file';
  phase: CapturePhase;
  draft: string;
  partialTranscript: string;
  captureId: string | null;
  error: string | null;
};

export type WorkspaceActivity = {
  summary: string;
  counts: MindMapChangeSummary;
  rejectedCommands: MindMapRejectedCommand[];
  changedNodeIds: string[];
  occurredAt: string;
} | null;

export type WorkspaceState = WorkspaceSnapshot & {
  savedInputs: SavedInput[];
  acknowledgedCaptureIds: string[];
  notice: string | null;
  captureSession: CaptureSession;
  selection: { nodeId: string | null };
  activity: WorkspaceActivity;
  history: { past: WorkspaceSnapshot[]; future: WorkspaceSnapshot[] };
  serviceStatus: RuntimeStatus | null;
  feedback: string[];
  request: {
    generation: number;
    inFlight: boolean;
    baseRevision: number | null;
  };
  pendingCaptures: CaptureRecord[];
};
