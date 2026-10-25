import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createApp } from './app';
import { loadEnv } from './config/env';
import { MindMapChangeService } from './modules/ai/mind-map-change.service';
import { ApiMindMapChangeProvider } from './infrastructure/ai/api-change-provider';
import { OllamaMindMapChangeProvider } from './infrastructure/ai/ollama-change-provider';
import { CaptureJournalStore } from './modules/capture-journal/capture-journal';
import { attachRealtimeTranscriptionServer } from './realtime-transcription-server';
import { shutdownRuntime } from './runtime/shutdown';
import { AudioTranscriptionService } from './modules/transcription/audio-transcription.service';

const env = loadEnv();
const shutdownToken = env.localShutdownToken || randomBytes(24).toString('hex');
const captureJournal = new CaptureJournalStore();
const localAI =
  env.provider === 'api'
    ? new ApiMindMapChangeProvider({
        baseUrl: env.remoteAiBaseUrl!,
        apiKey: env.remoteAiApiKey!,
        model: env.remoteAiModel!,
      })
    : new OllamaMindMapChangeProvider({
        baseUrl: env.localAiBaseUrl,
        model: env.localAiModel,
        contextSize: env.localAiContext,
        debugMindMap: env.debugMindMap,
      });
const mindMapChangeService = new MindMapChangeService(localAI);
const audioTranscriptionService = new AudioTranscriptionService({
  serviceUrl: `http://127.0.0.1:${env.funasrHttpPort}/transcribe`,
  healthUrl: `http://127.0.0.1:${env.funasrHttpPort}/docs`,
});
const server = createServer();

const app = createApp({
  env,
  audioTranscriptionService,
  mindMapChangeService,
  captureJournal,
  aiReady: () => localAI.isReady(),
  shutdown: () => {
    void shutdownRuntime(process.pid, {
      runtimePidFile: resolve(process.cwd(), '.runtime-pids.json'),
      runtimeId: env.runtimeId,
      projectRoot: process.cwd(),
    }).finally(() => {
      server.close(() => {
        process.exit(0);
      });

      setTimeout(() => {
        process.exit(0);
      }, 250);
    });
  },
  shutdownToken,
  staticDirectory: process.env.SERVE_STATIC === 'true' ? resolve(process.cwd(), 'dist') : undefined,
});

server.on('request', app);
attachRealtimeTranscriptionServer(server, {
  upstreamPort: env.funasrWsPort,
  allowedOrigins: new Set([
    `http://127.0.0.1:${env.frontendPort}`,
    `http://localhost:${env.frontendPort}`,
  ]),
});

server.listen(env.port, env.host, () => {
  console.log(`Mind map API started: http://${env.host}:${env.port}`);
  if (!env.localShutdownToken) {
    console.log(`Generated local shutdown token for this session: ${shutdownToken}`);
  }
});
