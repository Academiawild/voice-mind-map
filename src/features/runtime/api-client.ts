import {
  CaptureOrganizedResponseSchema,
  PendingCapturesResponseSchema,
  TranscriptionResponseSchema,
  type CaptureRecord,
} from '../../../shared/capture';
import {
  MindMapChangeRequestSchema,
  MindMapChangeResponseSchema,
  type MindMapChangeRequest,
  type MindMapChangeResponse,
} from '../../../shared/mind-map';
import { RuntimeStatusSchema, type RuntimeStatus } from '../../../shared/runtime';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly issues?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function responseError(response: Response) {
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
    message?: string;
    code?: string;
    issues?: unknown;
  } | null;
  return new ApiError(
    payload?.error ?? payload?.message ?? `Request failed with status ${response.status}.`,
    response.status,
    payload?.code,
    payload?.issues,
  );
}

async function parseResponse<T>(
  response: Response,
  schema: {
    safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: unknown };
  },
) {
  if (!response.ok) throw await responseError(response);
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    throw new ApiError(
      '服务返回了无效数据，已阻止其进入工作区。',
      502,
      'INVALID_RESPONSE',
      parsed.error,
    );
  }
  return parsed.data;
}

export async function getRuntimeStatus(signal?: AbortSignal): Promise<RuntimeStatus> {
  return parseResponse(await fetch('/api/status', { signal }), RuntimeStatusSchema);
}

export async function requestMindMapChange(
  request: MindMapChangeRequest,
  signal?: AbortSignal,
): Promise<MindMapChangeResponse> {
  const body = MindMapChangeRequestSchema.parse(request);
  return parseResponse(
    await fetch('/api/mind-map/change', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    }),
    MindMapChangeResponseSchema,
  );
}

function audioForm(audio: Blob, filename: string) {
  const form = new FormData();
  form.append('audio', audio, filename);
  return form;
}

export async function transcribeFile(audio: Blob, filename: string, signal?: AbortSignal) {
  return parseResponse(
    await fetch('/api/transcription/file', {
      method: 'POST',
      body: audioForm(audio, filename),
      signal,
    }),
    TranscriptionResponseSchema,
  );
}

export async function archiveRealtimeRecording(audio: Blob, transcript: string) {
  const form = audioForm(audio, 'recording.webm');
  form.append('transcript', transcript);
  return parseResponse(
    await fetch('/api/transcription/archive', { method: 'POST', body: form }),
    TranscriptionResponseSchema,
  );
}

export async function getPendingCaptures(signal?: AbortSignal): Promise<CaptureRecord[]> {
  const result = await parseResponse(
    await fetch('/api/captures/pending', { signal }),
    PendingCapturesResponseSchema,
  );
  return result.captures;
}

export async function markCaptureOrganized(id: string) {
  return parseResponse(
    await fetch(`/api/captures/${encodeURIComponent(id)}/organized`, { method: 'POST' }),
    CaptureOrganizedResponseSchema,
  );
}

export async function shutdownRuntime(token: string) {
  const response = await fetch('/api/runtime/shutdown', {
    method: 'POST',
    headers: { 'x-local-shutdown-token': token },
  });
  if (!response.ok) throw await responseError(response);
}

export function transcriptionSocketUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/transcription/stream`;
}
