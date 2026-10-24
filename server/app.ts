import cors from 'cors';
import express from 'express';
import { resolve } from 'node:path';
import type { AppEnv } from './config/env';
import type { MindMapChangeService } from './modules/ai/mind-map-change.service';
import type { CaptureJournalStore } from './modules/capture-journal/capture-journal';
import { createCapturesRouter } from './routes/captures.route';
import { createMindMapChangeRouter } from './routes/mind-map-change.route';
import { createRuntimeRouter } from './routes/runtime.route';
import { createStatusRouter } from './routes/status.route';
import { createTranscriptionRouter } from './routes/transcription.route';
import type { AudioTranscriptionService } from './modules/transcription/audio-transcription.service';

export function createApp(options: {
  env: AppEnv;
  audioTranscriptionService: AudioTranscriptionService;
  mindMapChangeService: MindMapChangeService;
  captureJournal: CaptureJournalStore;
  aiReady: () => Promise<boolean>;
  staticDirectory?: string;
  shutdown: () => void;
  shutdownToken: string;
}) {
  const app = express();
  const allowedOrigins = new Set([
    `http://127.0.0.1:${options.env.frontendPort}`,
    `http://localhost:${options.env.frontendPort}`,
  ]);

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin)) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  app.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      next();
      return;
    }

    const origin = req.header('origin');
    if (!origin || allowedOrigins.has(origin)) {
      next();
      return;
    }

    res.status(403).json({
      error: 'Cross-origin write requests are not allowed.',
      code: 'ORIGIN_NOT_ALLOWED',
    });
  });

  app.use(
    '/api',
    createStatusRouter({
      runtimeId: options.env.runtimeId,
      shutdownToken: options.shutdownToken,
      aiReady: options.aiReady,
      aiModel: options.env.localAiModel,
      transcriptionModels: {
        http: options.env.funasrModel,
        realtime: 'Paraformer streaming',
      },
      realtimePort: options.env.funasrWsPort,
      audioTranscriptionService: options.audioTranscriptionService,
    }),
  );
  app.use(
    '/api',
    createTranscriptionRouter(options.audioTranscriptionService, {
      captureJournal: options.captureJournal,
    }),
  );
  app.use('/api', createCapturesRouter(options.captureJournal));
  app.use(
    '/api',
    createMindMapChangeRouter(options.mindMapChangeService, options.env.debugMindMap),
  );
  app.use('/api', createRuntimeRouter(options.shutdown, options.shutdownToken));

  if (options.staticDirectory) {
    const staticDirectory = resolve(options.staticDirectory);
    app.use(
      express.static(staticDirectory, {
        setHeaders(res, filePath) {
          if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-store');
          }
        },
      }),
    );
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/')) {
        next();
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(resolve(staticDirectory, 'index.html'));
    });
  }

  return app;
}
