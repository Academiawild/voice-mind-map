import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppEnv } from './config/env';
import { createApp } from './app';
import type { MindMapChangeService } from './modules/ai/mind-map-change.service';
import type { CaptureJournalStore } from './modules/capture-journal/capture-journal';
import type { AudioTranscriptionService } from './modules/transcription/audio-transcription.service';

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

const env: AppEnv = {
  provider: 'ollama',
  host: '127.0.0.1',
  port: 8787,
  frontendPort: 5173,
  debugMindMap: false,
  funasrHttpPort: 10096,
  funasrModel: 'paraformer-zh',
  funasrPuncModel: 'ct-punc',
  funasrPython: 'python',
  funasrVadModel: 'fsmn-vad',
  funasrWsPort: 10095,
  localAiBaseUrl: 'http://127.0.0.1:11434',
  localAiContext: 16384,
  localAiModel: 'qwen-q4kp',
  runtimeId: 'runtime-test',
};

async function startApp() {
  const app = createApp({
    env,
    audioTranscriptionService: {
      isReady: async () => false,
    } as AudioTranscriptionService,
    mindMapChangeService: {} as MindMapChangeService,
    captureJournal: {
      listPending: async () => [],
    } as unknown as CaptureJournalStore,
    aiReady: async () => true,
    shutdown: () => undefined,
    shutdownToken: 'secret',
  });
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind.');
  return `http://127.0.0.1:${address.port}`;
}

describe('local app contracts and security', () => {
  it('returns consolidated runtime and model status', async () => {
    const baseUrl = await startApp();
    const response = await fetch(`${baseUrl}/api/status`);
    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: 'voice-mind-map',
      runtimeId: 'runtime-test',
      shutdownToken: 'secret',
      ai: {
        ready: true,
        provider: 'ollama',
        model: 'qwen-q4kp',
      },
      transcription: {
        http: { ready: false, model: 'paraformer-zh' },
        realtime: { model: 'Paraformer streaming' },
      },
    });
  });

  it('rejects cross-origin writes with structured JSON', async () => {
    const baseUrl = await startApp();
    const response = await fetch(`${baseUrl}/api/runtime/shutdown`, {
      method: 'POST',
      headers: { Origin: 'https://example.com', 'x-local-shutdown-token': 'secret' },
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'ORIGIN_NOT_ALLOWED' });
  });

  it('does not expose removed V1 endpoints', async () => {
    const baseUrl = await startApp();
    for (const endpoint of ['/api/health', '/api/runtime', '/api/recovery', '/api/transcribe']) {
      expect((await fetch(`${baseUrl}${endpoint}`)).status).toBe(404);
    }
  });
});
