import { useCallback, useEffect, useRef, useState } from 'react';
import type { RecognizedCaptureRecord } from '../../../shared/capture';
import {
  archiveRealtimeRecording,
  transcribeFile,
  transcriptionSocketUrl,
} from '../runtime/api-client';
import type { CapturePhase } from '../workspace/model';
import { createBlobRecorder, createPcmCapture, type PcmCapture } from './audio-adapters';

const MIN_RECORDING_MS = 3000;
const MIN_AUDIO_BYTES = 1000;
const MIN_PEAK = 0.006;
const FINAL_RESULT_WAIT_MS = 8000;
const MAX_PENDING_PCM_BYTES = 512 * 1024;

type BlobRecorder = ReturnType<typeof createBlobRecorder>;

export function useRecorderMachine(options: {
  realtimeReady: boolean;
  httpReady: boolean;
  onPhase: (phase: CapturePhase, error?: string) => void;
  onPartial: (text: string) => void;
  onRecognized: (capture: RecognizedCaptureRecord) => void;
}) {
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const resources = useRef<{
    stream: MediaStream;
    tracksStopped: boolean;
    recorder: BlobRecorder;
    pcm: PcmCapture | null;
    socket: WebSocket | null;
    startedAt: number;
    peak: number;
    realtimeFailed: boolean;
    stopping: boolean;
    endSent: boolean;
    receivedFinal: boolean;
    transcript: string;
    finalWaiter: (() => void) | null;
  } | null>(null);
  const timer = useRef<number | null>(null);
  const startGeneration = useRef(0);

  const release = useCallback(async () => {
    startGeneration.current += 1;
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
    const active = resources.current;
    resources.current = null;
    setIsRecording(false);
    if (!active) return;
    active.finalWaiter?.();
    active.socket?.close();
    if (!active.tracksStopped) active.stream.getTracks().forEach((track) => track.stop());
    await active.pcm?.close().catch(() => undefined);
  }, []);

  useEffect(() => () => void release(), [release]);

  const start = useCallback(async () => {
    if (resources.current || (!options.httpReady && !options.realtimeReady)) return;
    const generation = ++startGeneration.current;
    let acquiredStream: MediaStream | null = null;
    options.onPhase('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      acquiredStream = stream;
      if (generation !== startGeneration.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const recorder = createBlobRecorder(stream);
      const socket = options.realtimeReady ? new WebSocket(transcriptionSocketUrl()) : null;
      const active = {
        stream,
        tracksStopped: false,
        recorder,
        pcm: null as PcmCapture | null,
        socket,
        startedAt: Date.now(),
        peak: 0,
        realtimeFailed: false,
        stopping: false,
        endSent: false,
        receivedFinal: false,
        transcript: '',
        finalWaiter: null as (() => void) | null,
      };
      resources.current = active;
      setIsRecording(true);

      if (socket) {
        socket.binaryType = 'arraybuffer';
        socket.onmessage = (event) => {
          if (resources.current !== active) return;
          try {
            const message = JSON.parse(String(event.data)) as
              | { type: 'partial' | 'final'; text: string; complete?: boolean }
              | { type: 'error'; error: string };
            if (message.type === 'error') {
              active.realtimeFailed = true;
              active.finalWaiter?.();
              return;
            }
            if (!['partial', 'final'].includes(message.type) || typeof message.text !== 'string') {
              throw new Error('Invalid realtime transcript.');
            }
            if (message.text.trim()) active.transcript = message.text.trim();
            options.onPartial(active.transcript);
            if (message.type === 'final' && message.complete === true && active.endSent) {
              active.receivedFinal = true;
              active.finalWaiter?.();
            }
          } catch {
            active.realtimeFailed = true;
            active.finalWaiter?.();
          }
        };
        socket.onerror = () => {
          active.realtimeFailed = true;
          active.finalWaiter?.();
        };
        socket.onclose = () => {
          if (!active.receivedFinal) active.realtimeFailed = true;
          active.finalWaiter?.();
        };
      }

      const pendingFrames: ArrayBuffer[] = [];
      let pendingBytes = 0;
      if (socket) {
        socket.onopen = () => {
          if (resources.current !== active || active.stopping || active.realtimeFailed) return;
          for (const frame of pendingFrames.splice(0)) socket.send(frame);
          pendingBytes = 0;
        };
      }
      active.pcm = await createPcmCapture({
        stream,
        onFrame: (frame) => {
          if (active.stopping || active.realtimeFailed || !socket) return;
          if (socket.readyState === WebSocket.OPEN) socket.send(frame);
          else if (
            socket.readyState === WebSocket.CONNECTING &&
            pendingBytes + frame.byteLength <= MAX_PENDING_PCM_BYTES
          ) {
            pendingFrames.push(frame);
            pendingBytes += frame.byteLength;
          } else {
            active.realtimeFailed = true;
            pendingFrames.length = 0;
          }
        },
        onLevel: (peak) => {
          active.peak = Math.max(active.peak, peak);
          setAudioLevel(Math.min(1, peak * 8));
        },
      });
      if (resources.current !== active) {
        await active.pcm.close();
        return;
      }
      recorder.start();
      options.onPhase('recording');
      timer.current = window.setInterval(() => {
        setRecordingSeconds(Math.floor((Date.now() - active.startedAt) / 1000));
      }, 250);
    } catch (error) {
      if (generation !== startGeneration.current) return;
      if (resources.current?.stream !== acquiredStream)
        acquiredStream?.getTracks().forEach((track) => track.stop());
      await release();
      options.onPhase('failed', error instanceof Error ? error.message : '无法开始录音。');
    }
  }, [options, release]);

  const stop = useCallback(async () => {
    const active = resources.current;
    if (!active || active.stopping) return;
    const duration = Date.now() - active.startedAt;
    if (duration < MIN_RECORDING_MS) {
      options.onPhase('recording', '请继续说话，录音至少需要 3 秒。');
      return;
    }
    options.onPhase('finalizing');
    active.stopping = true;
    setIsRecording(false);
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
    try {
      // Freeze both recording paths before sending end; no PCM may follow it.
      const pcm = active.pcm;
      active.pcm = null;
      const [blob] = await Promise.all([active.recorder.stop(), pcm?.close()]);
      active.stream.getTracks().forEach((track) => track.stop());
      active.tracksStopped = true;
      if (blob.size < MIN_AUDIO_BYTES || active.peak < MIN_PEAK) {
        throw new Error('没有检测到清晰语音，请检查麦克风和音量。');
      }

      if (active.socket?.readyState === WebSocket.OPEN && !active.realtimeFailed) {
        const finalResult = new Promise<void>((resolve) => {
          const timeout = window.setTimeout(resolve, FINAL_RESULT_WAIT_MS);
          active.finalWaiter = () => {
            window.clearTimeout(timeout);
            resolve();
          };
        });
        // Register the waiter first: a fast final response must not be missed.
        active.endSent = true;
        active.socket.send(JSON.stringify({ type: 'end' }));
        await finalResult;
        active.finalWaiter = null;
      }
      if (resources.current !== active) return;
      if (!active.receivedFinal) active.realtimeFailed = true;
      active.socket?.close();

      let capture: RecognizedCaptureRecord;
      if (active.transcript && !active.realtimeFailed) {
        options.onPhase('archiving');
        capture = (await archiveRealtimeRecording(blob, active.transcript)).capture;
      } else {
        options.onPhase('transcribing');
        capture = (await transcribeFile(blob, 'recording.webm')).capture;
      }
      options.onRecognized(capture);
    } catch (error) {
      options.onPhase('failed', error instanceof Error ? error.message : '语音识别失败。');
    } finally {
      await release();
      setRecordingSeconds(0);
      setAudioLevel(0);
    }
  }, [options, release]);

  return {
    start,
    stop,
    isRecording,
    recordingSeconds,
    audioLevel,
  };
}
