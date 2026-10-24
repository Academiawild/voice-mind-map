import { describe, expect, it } from 'vitest';
import { canTransitionCapturePhase } from './capture-machine';

describe('capture session state machine', () => {
  it('accepts realtime success and fallback paths', () => {
    const realtime = [
      'idle',
      'requesting',
      'recording',
      'finalizing',
      'archiving',
      'organizing',
      'completed',
    ] as const;
    const fallback = [
      'idle',
      'requesting',
      'recording',
      'finalizing',
      'transcribing',
      'organizing',
      'completed',
    ] as const;
    for (const path of [realtime, fallback]) {
      expect(
        path.slice(1).every((phase, index) => canTransitionCapturePhase(path[index]!, phase)),
      ).toBe(true);
    }
  });

  it('rejects recording states jumping directly to completion', () => {
    expect(canTransitionCapturePhase('recording', 'completed')).toBe(false);
    expect(canTransitionCapturePhase('requesting', 'archiving')).toBe(false);
    expect(canTransitionCapturePhase('failed', 'requesting')).toBe(true);
  });
});
