import { Router } from 'express';
import { RuntimeStatusSchema } from '../../shared/runtime';
import type { AudioTranscriptionService } from '../modules/transcription/audio-transcription.service';
import { checkRealtimeReady } from './transcription.route';

export function createStatusRouter(options: {
  runtimeId: string;
  shutdownToken: string;
  aiReady: () => Promise<boolean>;
  aiModel: string;
  aiProvider?: 'ollama' | 'api';
  transcriptionModels: { http: string; realtime: string };
  realtimePort: number;
  audioTranscriptionService: AudioTranscriptionService;
}) {
  const router = Router();
  router.get('/status', async (_req, res) => {
    const [aiReady, httpReady, realtimeReady] = await Promise.all([
      options.aiReady(),
      options.audioTranscriptionService.isReady(),
      checkRealtimeReady(options.realtimePort),
    ]);
    res.json(
      RuntimeStatusSchema.parse({
        ok: true,
        service: 'voice-mind-map',
        runtimeId: options.runtimeId,
        shutdownToken: options.shutdownToken,
        ai: { ready: aiReady, provider: options.aiProvider ?? 'ollama', model: options.aiModel },
        transcription: {
          http: { ready: httpReady, model: options.transcriptionModels.http },
          realtime: { ready: realtimeReady, model: options.transcriptionModels.realtime },
        },
      }),
    );
  });
  return router;
}
