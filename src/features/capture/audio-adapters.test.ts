import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPcmCapture } from './audio-adapters';

const originalAudioContext = globalThis.AudioContext;
const originalAudioWorkletNode = globalThis.AudioWorkletNode;
const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;

afterEach(() => {
  Object.defineProperty(globalThis, 'AudioContext', {
    value: originalAudioContext,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'AudioWorkletNode', {
    value: originalAudioWorkletNode,
    configurable: true,
  });
  URL.createObjectURL = originalCreateObjectUrl;
  URL.revokeObjectURL = originalRevokeObjectUrl;
});

function installAudioMocks(worklet: boolean) {
  const addModule = vi.fn(async () => undefined);
  const createScriptProcessor = vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    onaudioprocess: null,
  }));
  class FakeAudioContext {
    sampleRate = 48_000;
    state = 'running';
    destination = {};
    audioWorklet = worklet ? { addModule } : undefined;
    createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
    createGain = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 } }));
    createScriptProcessor = createScriptProcessor;
    close = vi.fn(async () => undefined);
  }
  class FakeWorkletNode {
    connect = vi.fn();
    disconnect = vi.fn();
    port = { onmessage: null };
  }
  Object.defineProperty(globalThis, 'AudioContext', {
    value: FakeAudioContext,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'AudioWorkletNode', {
    value: worklet ? FakeWorkletNode : undefined,
    configurable: true,
  });
  URL.createObjectURL = vi.fn(() => 'blob:worklet');
  URL.revokeObjectURL = vi.fn();
  return { addModule, createScriptProcessor };
}

describe('PCM capture adapters', () => {
  it('prefers AudioWorklet and falls back to ScriptProcessor', async () => {
    const preferred = installAudioMocks(true);
    const first = await createPcmCapture({
      stream: {} as MediaStream,
      onFrame: vi.fn(),
      onLevel: vi.fn(),
    });
    expect(preferred.addModule).toHaveBeenCalledOnce();
    expect(preferred.createScriptProcessor).not.toHaveBeenCalled();
    await first.close();

    const fallback = installAudioMocks(false);
    const second = await createPcmCapture({
      stream: {} as MediaStream,
      onFrame: vi.fn(),
      onLevel: vi.fn(),
    });
    expect(fallback.createScriptProcessor).toHaveBeenCalledOnce();
    await second.close();
  });
});
