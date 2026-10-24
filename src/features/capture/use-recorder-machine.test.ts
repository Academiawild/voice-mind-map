import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { archiveRealtimeRecording, transcribeFile } from '../runtime/api-client';
import { createBlobRecorder, createPcmCapture } from './audio-adapters';
import { useRecorderMachine } from './use-recorder-machine';

vi.mock('../runtime/api-client', () => ({
  archiveRealtimeRecording: vi.fn(),
  transcribeFile: vi.fn(),
  transcriptionSocketUrl: () => 'ws://127.0.0.1/api/transcription/stream',
}));
vi.mock('./audio-adapters', () => ({ createBlobRecorder: vi.fn(), createPcmCapture: vi.fn() }));

class TestSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static initialState = 1;
  static instances: TestSocket[] = [];
  readyState = TestSocket.initialState;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onopen: (() => void) | null = null;
  send = vi.fn();
  constructor() {
    TestSocket.instances.push(this);
  }
  emit(type: 'partial' | 'final', text: string, complete = false) {
    this.onmessage?.({ data: JSON.stringify({ type, text, complete }) });
  }
  close() {
    if (this.readyState === TestSocket.CLOSED) return;
    this.readyState = TestSocket.CLOSED;
    this.onclose?.();
  }
}

const blob = new Blob([new Uint8Array(4096)], { type: 'audio/webm' });
const capture = {
  id: '11111111-1111-4111-8111-111111111111',
  source: 'realtime' as const,
  status: 'recognized' as const,
  transcript: '完整的录音内容，包括最后一句。',
  recordingDir: 'outputs/test',
  createdAt: '2026-09-08T00:00:00Z',
  updatedAt: '2026-09-08T00:00:00Z',
};
const stopTrack = vi.fn();
const stopBlob = vi.fn();
const closePcm = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.resetAllMocks();
  TestSocket.instances = [];
  TestSocket.initialState = TestSocket.OPEN;
  vi.stubGlobal('WebSocket', TestSocket);
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }),
    },
  });
  stopBlob.mockResolvedValue(blob);
  closePcm.mockResolvedValue(undefined);
  vi.mocked(createBlobRecorder).mockReturnValue({
    start: vi.fn(),
    stop: stopBlob,
    state: 'recording',
  });
  vi.mocked(createPcmCapture).mockImplementation(async ({ onLevel }) => {
    onLevel(0.5);
    return { close: closePcm };
  });
  vi.mocked(archiveRealtimeRecording).mockResolvedValue({ capture });
  vi.mocked(transcribeFile).mockResolvedValue({ capture });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function recording() {
  const options = {
    realtimeReady: true,
    httpReady: true,
    onPhase: vi.fn(),
    onPartial: vi.fn(),
    onRecognized: vi.fn(),
  };
  const hook = renderHook(() => useRecorderMachine(options));
  await act(() => hook.result.current.start());
  return { hook, options, socket: TestSocket.instances[0] };
}

describe('recording completion', () => {
  it('waits for a delayed final after two minutes of speech instead of archiving a partial', async () => {
    const { hook, options, socket } = await recording();
    await act(async () => {
      for (let minute = 0; minute < 2; minute++) {
        await vi.advanceTimersByTimeAsync(60_000);
        socket.emit('partial', `第 ${minute + 1} 分钟的内容`);
      }
    });
    expect(hook.result.current.recordingSeconds).toBe(120);
    let stopping!: Promise<void>;
    await act(async () => {
      stopping = hook.result.current.stop();
    });
    expect(closePcm).toHaveBeenCalledOnce();
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'end' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
      expect(archiveRealtimeRecording).not.toHaveBeenCalled();
      socket.emit('final', capture.transcript, true);
      await stopping;
    });
    expect(archiveRealtimeRecording).toHaveBeenCalledWith(blob, capture.transcript);
    expect(transcribeFile).not.toHaveBeenCalled();
    expect(options.onRecognized).toHaveBeenCalledWith(capture);
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(hook.result.current.isRecording).toBe(false);
    hook.unmount();
  });

  it('uses the entire recorded Blob after a connection closes with only partial text', async () => {
    const { hook, socket } = await recording();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
      socket.emit('partial', '前半截');
      socket.close();
      await hook.result.current.stop();
    });
    expect(archiveRealtimeRecording).not.toHaveBeenCalled();
    expect(transcribeFile).toHaveBeenCalledWith(blob, 'recording.webm');
    hook.unmount();
  });

  it('does not mistake a segment final during recording for completion of the recording', async () => {
    const { hook, socket } = await recording();
    let stopping!: Promise<void>;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      socket.emit('final', '已经确认的第一段');
      await vi.advanceTimersByTimeAsync(60_000);
      socket.emit('partial', '后面还有一段');
      stopping = hook.result.current.stop();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
      await stopping;
    });
    expect(transcribeFile).toHaveBeenCalledWith(blob, 'recording.webm');
    expect(archiveRealtimeRecording).not.toHaveBeenCalled();
    hook.unmount();
  });

  it('handles a final arriving immediately when end is sent and ignores a second stop', async () => {
    const { hook, socket } = await recording();
    socket.send.mockImplementation(() => socket.emit('final', capture.transcript, true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
      await Promise.all([hook.result.current.stop(), hook.result.current.stop()]);
    });
    expect(stopBlob).toHaveBeenCalledOnce();
    expect(archiveRealtimeRecording).toHaveBeenCalledOnce();
    hook.unmount();
  });

  it('ignores a queued segment final after stop until the recording completion arrives', async () => {
    const { hook, socket } = await recording();
    let stopping!: Promise<void>;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
      stopping = hook.result.current.stop();
    });
    await act(async () => {
      socket.emit('final', '这是排队中的上一段');
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(archiveRealtimeRecording).not.toHaveBeenCalled();
    await act(async () => {
      socket.emit('final', capture.transcript, true);
      await stopping;
    });
    expect(archiveRealtimeRecording).toHaveBeenCalledWith(blob, capture.transcript);
    hook.unmount();
  });

  it('buffers opening speech until the local websocket connects and stops PCM before end', async () => {
    TestSocket.initialState = TestSocket.CONNECTING;
    const { hook, socket } = await recording();
    const pcm = vi.mocked(createPcmCapture).mock.calls[0][0];
    const firstFrame = new ArrayBuffer(100);
    pcm.onFrame(firstFrame);
    expect(socket.send).not.toHaveBeenCalled();
    socket.readyState = TestSocket.OPEN;
    socket.onopen?.();
    expect(socket.send).toHaveBeenCalledWith(firstFrame);
    socket.send.mockImplementation((value) => {
      if (typeof value === 'string') socket.emit('final', capture.transcript, true);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
      const stopping = hook.result.current.stop();
      pcm.onFrame(new ArrayBuffer(100));
      await stopping;
    });
    expect(socket.send).toHaveBeenCalledTimes(2);
    hook.unmount();
  });

  it('releases microphone tracks when PCM initialization fails', async () => {
    vi.mocked(createPcmCapture).mockRejectedValueOnce(new Error('AudioContext unavailable'));
    const { hook, options } = await recording();
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(options.onPhase).toHaveBeenLastCalledWith('failed', 'AudioContext unavailable');
    expect(hook.result.current.isRecording).toBe(false);
    hook.unmount();
  });

  it('releases an acquired microphone when MediaRecorder cannot initialize', async () => {
    vi.mocked(createBlobRecorder).mockImplementationOnce(() => {
      throw new Error('Unsupported recording format');
    });
    const { hook, options } = await recording();
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(createPcmCapture).not.toHaveBeenCalled();
    expect(options.onPhase).toHaveBeenLastCalledWith('failed', 'Unsupported recording format');
    hook.unmount();
  });

  it('releases late microphone permission results after leaving the page', async () => {
    let permit!: (stream: MediaStream) => void;
    vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValueOnce(
      new Promise((resolve) => {
        permit = resolve;
      }),
    );
    const options = {
      realtimeReady: true,
      httpReady: true,
      onPhase: vi.fn(),
      onPartial: vi.fn(),
      onRecognized: vi.fn(),
    };
    const hook = renderHook(() => useRecorderMachine(options));
    let starting!: Promise<void>;
    act(() => {
      starting = hook.result.current.start();
    });
    hook.unmount();
    await act(async () => {
      permit({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream);
      await starting;
    });
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(createBlobRecorder).not.toHaveBeenCalled();
    expect(options.onPhase).toHaveBeenCalledTimes(1);
  });
});
