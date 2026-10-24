import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RecognizedCaptureRecord } from '../../../shared/capture';
import type { CaptureSession } from '../workspace/model';
import { useRecorderMachine } from './use-recorder-machine';

const PHASE_LABELS: Record<CaptureSession['phase'], string> = {
  idle: '准备捕捉',
  requesting: '正在请求麦克风',
  recording: '正在录音',
  finalizing: '正在补齐最后一句',
  transcribing: '本地完整转写中',
  archiving: '正在归档识别结果',
  organizing: 'AI 正在整理',
  completed: '整理完成',
  failed: '处理失败',
};

export function CaptureBar(props: {
  session: CaptureSession;
  aiReady: boolean;
  httpReady: boolean;
  realtimeReady: boolean;
  busy: boolean;
  focusedTitle?: string;
  focusRequest?: number;
  onClearFocus?: () => void;
  onCancel?: () => void;
  canRetry?: boolean;
  onRetry?: () => void;
  organizing?: boolean;
  onDraftChange: (value: string) => void;
  onPhase: (phase: CaptureSession['phase'], error?: string) => void;
  onPartial: (value: string) => void;
  onRecognized: (capture: RecognizedCaptureRecord) => void;
  onOrganize: () => void;
  onFile: (file: File) => void;
}) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const editor = useRef<HTMLTextAreaElement | null>(null);
  const [elapsed, setElapsed] = useState(0);
  useLayoutEffect(() => {
    const textarea = editor.current;
    if (!textarea) return;
    textarea.style.height = '0px';
    textarea.style.height = `${Math.min(180, Math.max(48, textarea.scrollHeight))}px`;
  }, [props.session.draft]);
  useEffect(() => {
    if (props.focusRequest) editor.current?.focus();
  }, [props.focusRequest]);
  useEffect(() => {
    if (!props.organizing) return;
    const started = Date.now();
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => {
      window.clearInterval(timer);
      setElapsed(0);
    };
  }, [props.organizing]);
  const recorder = useRecorderMachine({
    realtimeReady: props.realtimeReady,
    httpReady: props.httpReady,
    onPhase: props.onPhase,
    onPartial: props.onPartial,
    onRecognized: props.onRecognized,
  });
  const speechReady = props.httpReady || props.realtimeReady;
  const operationBusy = props.busy || recorder.isRecording;

  return (
    <section className="capture-bar" aria-label="想法捕捉">
      <div className="capture-editor">
        <div className="capture-context">
          <span className="capture-context-dot" />
          <span>{props.focusedTitle ? `围绕「${props.focusedTitle}」继续` : '全图思考'}</span>
          {props.focusedTitle ? (
            <button type="button" onClick={props.onClearFocus}>
              回到全图 ×
            </button>
          ) : (
            <small>说一个念头，或把所有事情一起放进来</small>
          )}
        </div>
        <textarea
          ref={editor}
          value={props.session.draft}
          rows={1}
          placeholder={
            props.focusedTitle
              ? '补充、质疑，或说说你真正的意思…'
              : '最近在想些什么？零散、矛盾、没想清楚，都可以。'
          }
          aria-label="待整理内容"
          onChange={(event) => props.onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (
              (event.metaKey || event.ctrlKey) &&
              event.key === 'Enter' &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              if (props.aiReady && !operationBusy && props.session.draft.trim()) props.onOrganize();
            }
          }}
        />
        {props.session.partialTranscript ? (
          <div className="capture-partial" aria-live="polite">
            {props.session.partialTranscript}
          </div>
        ) : null}
      </div>

      <div className="capture-actions">
        <div
          className={`capture-phase phase-${props.session.phase}`}
          aria-live={props.organizing ? 'off' : 'polite'}
        >
          <span>{PHASE_LABELS[props.session.phase]}</span>
          {props.organizing && <small>{elapsed}s · 你可以继续写</small>}
          {props.organizing && (
            <button type="button" className="capture-cancel" onClick={props.onCancel}>
              取消整理
            </button>
          )}
          {props.canRetry && (
            <button
              type="button"
              className="capture-retry"
              disabled={operationBusy}
              onClick={props.onRetry}
            >
              重试上次整理
            </button>
          )}
          {recorder.isRecording ? (
            <small>
              {recorder.recordingSeconds}s · 音量 {recorder.audioLevel > 0.08 ? '正常' : '偏低'}
            </small>
          ) : props.session.error ? (
            <small title={props.session.error}>{props.session.error}</small>
          ) : null}
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="audio/*,.m4a,.mp3,.wav,.webm,.aac,.ogg,.flac,.mp4,.3gp,.3g2"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) props.onFile(file);
            event.currentTarget.value = '';
          }}
        />
        <button
          type="button"
          className="capture-icon-button"
          onClick={() => fileInput.current?.click()}
          disabled={operationBusy}
        >
          导入音频
        </button>
        <button
          type="button"
          className={`capture-record-button ${recorder.isRecording ? 'is-recording' : ''}`}
          disabled={!recorder.isRecording && (!speechReady || props.busy)}
          onClick={() => void (recorder.isRecording ? recorder.stop() : recorder.start())}
        >
          {recorder.isRecording ? '结束录音' : props.realtimeReady ? '实时录音' : '录音'}
        </button>
        <button
          type="button"
          className="capture-submit-button"
          disabled={!props.aiReady || operationBusy || !props.session.draft.trim()}
          onClick={props.onOrganize}
        >
          {props.busy ? '整理中…' : '整理'}
          <kbd>⌘↵</kbd>
        </button>
      </div>
    </section>
  );
}
