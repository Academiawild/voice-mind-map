import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CaptureBar } from './capture-bar';

vi.mock('./use-recorder-machine', () => ({
  useRecorderMachine: () => ({
    start: vi.fn(),
    stop: vi.fn(),
    isRecording: false,
    recordingSeconds: 0,
    audioLevel: 0,
  }),
}));

afterEach(cleanup);

const idleSession = {
  mode: 'text' as const,
  phase: 'idle' as const,
  draft: '',
  partialTranscript: '',
  captureId: null,
  error: null,
};

describe('CaptureBar', () => {
  it('submits text with Cmd+Enter and exposes partial speech separately', async () => {
    const onDraftChange = vi.fn();
    const onOrganize = vi.fn();
    const { rerender } = render(
      <CaptureBar
        session={idleSession}
        aiReady
        httpReady
        realtimeReady
        busy={false}
        onDraftChange={onDraftChange}
        onPhase={vi.fn()}
        onPartial={vi.fn()}
        onRecognized={vi.fn()}
        onOrganize={onOrganize}
        onFile={vi.fn()}
      />,
    );
    const textbox = screen.getByRole('textbox', { name: '待整理内容' });
    await userEvent.type(textbox, '新的想法');
    expect(onDraftChange).toHaveBeenCalled();

    rerender(
      <CaptureBar
        session={{ ...idleSession, draft: '新的想法', partialTranscript: '还在说话' }}
        aiReady
        httpReady
        realtimeReady
        busy={false}
        onDraftChange={onDraftChange}
        onPhase={vi.fn()}
        onPartial={vi.fn()}
        onRecognized={vi.fn()}
        onOrganize={onOrganize}
        onFile={vi.fn()}
      />,
    );
    fireEvent.keyDown(screen.getByRole('textbox', { name: '待整理内容' }), {
      key: 'Enter',
      metaKey: true,
    });
    expect(onOrganize).toHaveBeenCalledOnce();
    expect(screen.getByText('还在说话')).toBeTruthy();
  });
});
