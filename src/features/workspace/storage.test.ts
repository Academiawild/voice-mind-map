import { beforeEach, describe, expect, it } from 'vitest';
import { loadWorkspaceSnapshot, saveWorkspaceSnapshot, WORKSPACE_STORAGE_KEY } from './storage';

describe('workspace V2 persistence', () => {
  beforeEach(() => window.localStorage.clear());

  it('does not read or delete historical workspace keys', () => {
    window.localStorage.setItem('voice-mind-map:workspace', '{"legacy":true}');

    expect(loadWorkspaceSnapshot()).toBeUndefined();
    expect(window.localStorage.getItem('voice-mind-map:workspace')).toBe('{"legacy":true}');
  });

  it('loads existing V2 snapshots with backward-compatible navigation and input defaults', () => {
    saveWorkspaceSnapshot({
      document: null,
      positions: { root: { x: 20, y: 40 } },
      viewport: { x: 1, y: 2, zoom: 0.8 },
      expandedInferenceNodeIds: ['root'],
    });

    expect(JSON.parse(window.localStorage.getItem(WORKSPACE_STORAGE_KEY) ?? '{}')).toEqual({
      document: null,
      positions: { root: { x: 20, y: 40 } },
      viewport: { x: 1, y: 2, zoom: 0.8 },
      expandedInferenceNodeIds: ['root'],
      navigation: [],
      savedInputs: [],
      draft: '',
      acknowledgedCaptureIds: [],
    });
  });
});
