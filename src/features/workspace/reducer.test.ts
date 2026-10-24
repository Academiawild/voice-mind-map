import { describe, expect, it } from 'vitest';
import { MindMapChangeResponseSchema, MindMapDocumentSchema } from '../../../shared/mind-map';
import { createEmptyWorkspaceState, workspaceReducer } from './reducer';

const initial = MindMapDocumentSchema.parse({
  schemaVersion: 2,
  revision: 1,
  title: '测试',
  root: {
    id: 'root',
    title: '测试',
    content: '',
    kind: 'topic',
    status: 'open',
    source: 'user',
    children: [],
  },
  relations: [],
  groups: [],
});
const updated = MindMapDocumentSchema.parse({
  ...initial,
  revision: 2,
  root: { ...initial.root, content: '更新' },
});
const response = MindMapChangeResponseSchema.parse({
  document: updated,
  changeSet: {
    baseRevision: 1,
    summary: '更新根节点',
    commands: [{ type: 'updateNode', nodeId: 'root', patch: { content: '更新' } }],
  },
  appliedCommands: [{ type: 'updateNode', nodeId: 'root', patch: { content: '更新' } }],
  rejectedCommands: [],
});

describe('workspaceReducer', () => {
  it('keeps text written during recording when the transcript arrives', () => {
    let state = createEmptyWorkspaceState({ draft: '录音期间写下的新念头' });
    state = workspaceReducer(state, { type: 'capture/phase', phase: 'requesting' });
    state = workspaceReducer(state, { type: 'capture/phase', phase: 'recording' });
    state = workspaceReducer(state, { type: 'capture/phase', phase: 'finalizing' });
    state = workspaceReducer(state, { type: 'capture/phase', phase: 'archiving' });
    state = workspaceReducer(state, {
      type: 'capture/recognized',
      captureId: 'voice',
      transcript: '这段是口述',
    });
    expect(state.captureSession.draft).toBe('录音期间写下的新念头');
  });
  it('preserves original inputs and the current viewport when undo cancels an in-flight analysis', () => {
    let state = createEmptyWorkspaceState({ document: initial, viewport: { x: 0, y: 0, zoom: 1 } });
    state = workspaceReducer(state, {
      type: 'input/save',
      input: { id: 'original', text: '我的原话', createdAt: '2026-09-07T00:00:00Z' },
    });
    state = workspaceReducer(state, {
      type: 'document/commit',
      document: updated,
      summary: '修改',
      changedNodeIds: ['root'],
    });
    state = workspaceReducer(state, {
      type: 'view/viewport',
      viewport: { x: 100, y: 80, zoom: 0.7 },
    });
    state = workspaceReducer(state, { type: 'request/start', generation: 1, baseRevision: 2 });
    state = workspaceReducer(state, { type: 'history/undo' });
    expect(state.savedInputs[0].text).toBe('我的原话');
    expect(state.viewport).toEqual({ x: 100, y: 80, zoom: 0.7 });
    expect(state.captureSession.phase).toBe('idle');
    expect(state.request.inFlight).toBe(false);
  });

  it('does not erase text typed while analysis is running and restores navigation on undo', () => {
    let state = createEmptyWorkspaceState({
      document: initial,
      navigation: [{ nodeId: 'root', reason: '原来的入口', nextStep: '先回忆' }],
    });
    state = workspaceReducer(state, { type: 'request/start', generation: 1, baseRevision: 1 });
    state = workspaceReducer(state, { type: 'capture/draft', draft: '刚想到的新内容' });
    state = workspaceReducer(state, {
      type: 'request/succeed',
      generation: 1,
      baseRevision: 1,
      submittedDraft: '之前的内容',
      response: {
        ...response,
        changeSet: {
          ...response.changeSet,
          navigation: [{ nodeId: 'root', reason: '新入口', nextStep: '比较两种可能' }],
        },
      },
    });
    expect(state.captureSession.draft).toBe('刚想到的新内容');
    expect(state.navigation?.[0].reason).toBe('新入口');
    state = workspaceReducer(state, { type: 'history/undo' });
    expect(state.navigation?.[0].reason).toBe('原来的入口');
  });
  it('commits AI responses and supports undo/redo snapshots', () => {
    let state = createEmptyWorkspaceState({ document: initial });
    state = workspaceReducer(state, { type: 'request/start', generation: 1, baseRevision: 1 });
    state = workspaceReducer(state, {
      type: 'request/succeed',
      generation: 1,
      baseRevision: 1,
      response,
    });
    expect(state.document?.revision).toBe(2);
    expect(state.history.past).toHaveLength(1);
    state = workspaceReducer(state, { type: 'history/undo' });
    expect(state.document?.revision).toBe(1);
    state = workspaceReducer(state, { type: 'history/redo' });
    expect(state.document?.revision).toBe(2);
  });

  it('ignores a response invalidated by undo generation', () => {
    let state = createEmptyWorkspaceState({ document: initial });
    state = workspaceReducer(state, {
      type: 'document/commit',
      document: updated,
      summary: '本地修改',
      changedNodeIds: ['root'],
    });
    state = workspaceReducer(state, { type: 'request/start', generation: 1, baseRevision: 2 });
    state = workspaceReducer(state, { type: 'history/undo' });
    const afterUndo = state;
    state = workspaceReducer(state, {
      type: 'request/succeed',
      generation: 1,
      baseRevision: 1,
      response,
    });
    expect(state).toBe(afterUndo);
    expect(state.document?.revision).toBe(1);
  });

  it('keeps partial speech outside the formal document', () => {
    const state = workspaceReducer(createEmptyWorkspaceState({ document: initial }), {
      type: 'capture/partial',
      transcript: '尚未完成的口述',
    });
    expect(state.captureSession.partialTranscript).toBe('尚未完成的口述');
    expect(state.document).toEqual(initial);
  });
});
