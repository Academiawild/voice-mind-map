import type { CapturePhase } from '../workspace/model';

const TRANSITIONS: Record<CapturePhase, ReadonlySet<CapturePhase>> = {
  idle: new Set(['requesting', 'transcribing', 'organizing', 'failed']),
  requesting: new Set(['recording', 'failed']),
  recording: new Set(['finalizing', 'failed']),
  finalizing: new Set(['transcribing', 'archiving', 'failed']),
  transcribing: new Set(['organizing', 'failed']),
  archiving: new Set(['organizing', 'failed']),
  organizing: new Set(['completed', 'failed']),
  completed: new Set(['requesting', 'transcribing', 'organizing', 'idle', 'failed']),
  failed: new Set(['requesting', 'transcribing', 'organizing', 'idle']),
};

export function canTransitionCapturePhase(current: CapturePhase, next: CapturePhase) {
  return current === next || TRANSITIONS[current].has(next);
}
