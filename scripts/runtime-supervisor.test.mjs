import { describe, expect, it, vi } from 'vitest';
import {
  RUNTIME_MANIFEST_VERSION,
  createRuntimeEnvironment,
  createRuntimeManifest,
  containsLocalModel,
  normalizeLocalAIBaseUrl,
  terminateManagedProcesses,
} from './runtime-supervisor.mjs';

describe('runtime supervisor manifest', () => {
  it('uses one web/API port in production and a versioned manifest', () => {
    const ports = { web: 8787, api: 8787, realtimeAsr: 10095, httpAsr: 10096 };
    const environment = createRuntimeEnvironment({
      mode: 'production',
      ports,
      runtimeId: 'runtime-test',
    });
    const manifest = createRuntimeManifest({
      mode: 'production',
      runtimeId: 'runtime-test',
      projectRoot: '/tmp/voice-mind-map',
      ports,
      processes: [],
    });
    expect(environment.SERVE_STATIC).toBe('true');
    expect(environment.PORT).toBe(environment.VITE_PORT);
    expect(manifest.version).toBe(RUNTIME_MANIFEST_VERSION);
    expect(manifest.webUrl).toBe('http://127.0.0.1:8787');
    expect(manifest.healthUrl).toBe('http://127.0.0.1:8787/api/status');
  });

  it('rolls back launched children in reverse order after startup failure', () => {
    const order = [];
    const first = { killed: false, exitCode: null, kill: vi.fn(() => order.push('first')) };
    const second = { killed: false, exitCode: null, kill: vi.fn(() => order.push('second')) };

    terminateManagedProcesses([first, second]);

    expect(order).toEqual(['second', 'first']);
    expect(first.kill).toHaveBeenCalledWith('SIGTERM');
    expect(second.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('matches Ollama latest tags without weakening the configured model name', () => {
    expect(containsLocalModel(['qwythos-9b:latest'], 'qwythos-9b')).toBe(true);
    expect(containsLocalModel(['qwen-q4kp:latest'], 'qwythos-9b')).toBe(false);
  });

  it('rejects non-loopback local AI URLs', () => {
    expect(normalizeLocalAIBaseUrl('http://127.0.0.1:11434/')).toBe('http://127.0.0.1:11434');
    expect(() => normalizeLocalAIBaseUrl('https://example.com')).toThrow(/loopback/i);
  });
});
