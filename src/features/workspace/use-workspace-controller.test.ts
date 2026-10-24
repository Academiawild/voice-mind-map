import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MindMapChangeResponseSchema } from '../../../shared/mind-map';
import {
  getPendingCaptures,
  getRuntimeStatus,
  markCaptureOrganized,
  requestMindMapChange,
  transcribeFile,
} from '../runtime/api-client';
import { useWorkspaceController } from './use-workspace-controller';

vi.mock('../runtime/api-client', () => ({
  getPendingCaptures: vi.fn(),
  getRuntimeStatus: vi.fn(),
  markCaptureOrganized: vi.fn(),
  requestMindMapChange: vi.fn(),
  shutdownRuntime: vi.fn(),
  transcribeFile: vi.fn(),
}));

const capture = {
  id: '11111111-1111-4111-8111-111111111111',
  source: 'file' as const,
  status: 'recognized' as const,
  transcript: '原话',
  recordingDir: 'outputs/test',
  createdAt: '2026-09-07T00:00:00Z',
  updatedAt: '2026-09-07T00:00:00Z',
};
const document = {
  schemaVersion: 2,
  revision: 1,
  title: '思考',
  root: {
    id: 'root',
    title: '思考',
    content: '',
    kind: 'topic',
    source: 'summary',
    status: 'open',
    children: [],
  },
  relations: [],
  groups: [],
};
const response = MindMapChangeResponseSchema.parse({
  document,
  changeSet: {
    baseRevision: 0,
    summary: '建立思考',
    commands: [],
    navigation: [{ nodeId: 'root', reason: '一个入口', nextStep: '比较选择' }],
  },
  appliedCommands: [],
  rejectedCommands: [],
});

describe('workspace controller', () => {
  it('retries the original input once without duplicating it or clearing a newer draft', async () => {
    vi.mocked(requestMindMapChange).mockRejectedValueOnce(new Error('思考超时'));
    const hook = renderHook(() => useWorkspaceController());
    await waitFor(() => expect(hook.result.current.state.serviceStatus?.ai.ready).toBe(true));
    act(() => hook.result.current.dispatch({ type: 'capture/draft', draft: '原来的输入' }));
    await act(() => hook.result.current.organize('原来的输入'));
    expect(hook.result.current.canRetry).toBe(true);
    act(() => hook.result.current.dispatch({ type: 'capture/draft', draft: '后来写的新草稿' }));
    await act(() => hook.result.current.retry());
    expect(vi.mocked(requestMindMapChange).mock.calls[1][0].input).toBe('原来的输入');
    expect(hook.result.current.state.captureSession.draft).toBe('后来写的新草稿');
    expect(hook.result.current.state.savedInputs).toHaveLength(1);
    expect(hook.result.current.canRetry).toBe(false);
    hook.unmount();
  });

  it('retries a generated action in its original context, without saving it as user words', async () => {
    vi.mocked(requestMindMapChange).mockRejectedValueOnce(new Error('offline'));
    const hook = renderHook(() => useWorkspaceController());
    await waitFor(() => expect(hook.result.current.state.serviceStatus?.ai.ready).toBe(true));
    act(() => hook.result.current.dispatch({ type: 'selection/set', nodeId: 'original' }));
    await act(() => hook.result.current.organize('挑战一下', { generated: true }));
    act(() => hook.result.current.dispatch({ type: 'selection/set', nodeId: 'different' }));
    await act(() => hook.result.current.retry());
    expect(vi.mocked(requestMindMapChange).mock.calls[1][0].selectedNodeId).toBe('original');
    expect(hook.result.current.state.savedInputs).toEqual([]);
    hook.unmount();
  });

  it('retains the imported audio for a failed transcription retry', async () => {
    const file = new File(['audio'], 'ideas.wav');
    vi.mocked(transcribeFile)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ capture });
    const hook = renderHook(() => useWorkspaceController());
    await waitFor(() => expect(hook.result.current.state.serviceStatus?.ai.ready).toBe(true));
    await act(() => hook.result.current.importAudio(file));
    expect(hook.result.current.canRetry).toBe(true);
    await act(() => hook.result.current.retry());
    expect(vi.mocked(transcribeFile).mock.calls.map((args) => args[0])).toEqual([file, file]);
    expect(requestMindMapChange).toHaveBeenCalledOnce();
    hook.unmount();
  });
  it('ignores late analysis after cancellation and keeps the original input', async () => {
    let resolveResponse!: (value: typeof response) => void;
    const deferred = new Promise<typeof response>((resolve) => {
      resolveResponse = resolve;
    });
    vi.mocked(requestMindMapChange).mockReturnValueOnce(deferred);
    const hook = renderHook(() => useWorkspaceController());
    await waitFor(() => expect(hook.result.current.state.serviceStatus?.ai.ready).toBe(true));
    let request!: Promise<void>;
    act(() => {
      request = hook.result.current.organize('取消后也要保留');
    });
    expect(hook.result.current.state.request.inFlight).toBe(true);
    act(() => hook.result.current.cancel());
    await act(async () => {
      resolveResponse(response);
      await request;
    });
    expect(hook.result.current.state.document).toBeNull();
    expect(hook.result.current.state.captureSession.phase).toBe('idle');
    expect(hook.result.current.state.savedInputs[0].text).toBe('取消后也要保留');
    hook.unmount();
  });
  beforeEach(() => {
    window.localStorage.clear();
    vi.resetAllMocks();
    vi.mocked(getRuntimeStatus).mockResolvedValue({
      ok: true,
      service: 'voice-mind-map',
      runtimeId: 'test',
      shutdownToken: 'test',
      ai: { ready: true, provider: 'ollama', model: 'test' },
      transcription: {
        http: { ready: true, model: 'test' },
        realtime: { ready: true, model: 'test' },
      },
    });
    vi.mocked(getPendingCaptures).mockResolvedValue([capture]);
    vi.mocked(requestMindMapChange).mockResolvedValue(response);
  });

  it('keeps a committed map successful when acknowledgement fails, including across reload', async () => {
    vi.mocked(markCaptureOrganized).mockRejectedValue(new Error('offline'));
    const first = renderHook(() => useWorkspaceController());
    await waitFor(() => expect(first.result.current.state.serviceStatus?.ai.ready).toBe(true));
    await act(() => first.result.current.resumeCapture(capture.id, capture.transcript));
    expect(first.result.current.state.document?.title).toBe('思考');
    expect(first.result.current.state.captureSession.phase).toBe('completed');
    expect(first.result.current.state.pendingCaptures).toEqual([]);
    expect(first.result.current.state.notice).toContain('无需重复整理');
    first.unmount();
    const second = renderHook(() => useWorkspaceController());
    await waitFor(() => expect(second.result.current.state.serviceStatus?.ai.ready).toBe(true));
    await act(() => second.result.current.resumeCapture(capture.id, capture.transcript));
    expect(requestMindMapChange).toHaveBeenCalledTimes(1);
    expect(second.result.current.state.savedInputs[0].text).toBe('原话');
    second.unmount();
  });

  it('honors an explicit whole-map request and preserves a user draft during generated navigation', async () => {
    const hook = renderHook(() => useWorkspaceController());
    await waitFor(() => expect(hook.result.current.state.serviceStatus?.ai.ready).toBe(true));
    act(() => {
      hook.result.current.dispatch({ type: 'selection/set', nodeId: 'selected' });
      hook.result.current.dispatch({ type: 'capture/draft', draft: '还没提交的念头' });
    });
    await act(() =>
      hook.result.current.organize('换个入口', { generated: true, selectedNodeId: null }),
    );
    expect(vi.mocked(requestMindMapChange).mock.calls[0][0].selectedNodeId).toBeNull();
    expect(hook.result.current.state.captureSession.draft).toBe('还没提交的念头');
    expect(hook.result.current.state.savedInputs).toEqual([]);
    hook.unmount();
  });

  it('leaves the busy state when the service returns a mismatched revision', async () => {
    vi.mocked(requestMindMapChange).mockResolvedValue({
      ...response,
      changeSet: { ...response.changeSet, baseRevision: 9 },
    });
    const hook = renderHook(() => useWorkspaceController());
    await waitFor(() => expect(hook.result.current.state.serviceStatus?.ai.ready).toBe(true));
    await act(() => hook.result.current.organize('仍然保留这个念头'));
    expect(hook.result.current.state.request.inFlight).toBe(false);
    expect(hook.result.current.state.captureSession.phase).toBe('failed');
    expect(hook.result.current.state.document).toBeNull();
    expect(hook.result.current.state.savedInputs[0].text).toBe('仍然保留这个念头');
    hook.unmount();
  });

  it('changes the thinking status without endorsing AI content, and can undo it', async () => {
    const inferenceResponse = structuredClone(response);
    inferenceResponse.document.root.source = 'inference';
    vi.mocked(requestMindMapChange).mockResolvedValue(inferenceResponse);
    const hook = renderHook(() => useWorkspaceController());
    await waitFor(() => expect(hook.result.current.state.serviceStatus?.ai.ready).toBe(true));
    await act(() => hook.result.current.organize('试着联想'));
    act(() => hook.result.current.setNodeStatus('root', 'later'));
    expect(hook.result.current.state.document?.root.status).toBe('later');
    expect(hook.result.current.state.document?.root.source).toBe('inference');
    act(() => hook.result.current.undo());
    expect(hook.result.current.state.document?.root.status).toBe('open');
    expect(hook.result.current.state.document?.root.source).toBe('inference');
    hook.unmount();
  });
});
