import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { WebSocket } from 'ws';
import {
  AudioInputError,
  type AudioTranscriptionService,
} from '../modules/transcription/audio-transcription.service';
import { TranscriptionResponseSchema } from '../../shared/capture';
import type { CaptureJournalStore } from '../modules/capture-journal/capture-journal';

const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const REALTIME_READY_CACHE_MS = 30_000;
let realtimeReadyCache = {
  checkedAt: 0,
  port: 0,
  ready: false,
};
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_AUDIO_BYTES,
    files: 1,
  },
});

function uploadAudio(): RequestHandler {
  return (req, res, next) => {
    upload.single('audio')(req, res, (error) => {
      if (!error) {
        next();
        return;
      }

      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({
          error: '音频文件不能超过 20 MB。',
          code: 'AUDIO_TOO_LARGE',
        });
        return;
      }

      res.status(400).json({
        error: error instanceof Error ? error.message : '音频上传失败。',
        code: 'AUDIO_UPLOAD_FAILED',
      });
    });
  };
}

export async function checkRealtimeReady(port: number) {
  if (
    realtimeReadyCache.ready &&
    realtimeReadyCache.port === port &&
    Date.now() - realtimeReadyCache.checkedAt < REALTIME_READY_CACHE_MS
  ) {
    return true;
  }

  return new Promise<boolean>((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, 'binary', {
      rejectUnauthorized: false,
    });
    let settled = false;

    const finish = (ready: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      realtimeReadyCache = {
        checkedAt: Date.now(),
        port,
        ready,
      };
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
      resolve(ready);
    };

    const timer = setTimeout(() => finish(false), 1200);
    socket.on('open', () => {
      clearTimeout(timer);
      finish(true);
    });
    socket.on('error', () => {
      clearTimeout(timer);
      finish(false);
    });
    socket.on('close', () => {
      clearTimeout(timer);
      finish(false);
    });
  });
}

function sendAudioError(res: Parameters<RequestHandler>[1], error: unknown) {
  const status = error instanceof AudioInputError ? error.status : 500;
  res.status(status).json({
    error: error instanceof Error ? error.message : '音频转写失败。',
    code: error instanceof AudioInputError ? error.code : 'AUDIO_TRANSCRIPTION_FAILED',
  });
}

export function createTranscriptionRouter(
  service: AudioTranscriptionService,
  options: {
    captureJournal: CaptureJournalStore;
  },
) {
  const router = Router();

  router.post('/transcription/file', uploadAudio(), async (req, res) => {
    if (!req.file?.buffer?.length) {
      res.status(400).json({ error: '请在 audio 字段上传音频文件。', code: 'AUDIO_MISSING' });
      return;
    }
    try {
      const result = await service.transcribeAudioWithArchive(req.file.buffer, {
        mimetype: req.file.mimetype,
        size: req.file.size,
        originalname: req.file.originalname,
      });
      const capture = await options.captureJournal.recordRecognized({
        source: 'file',
        transcript: result.text,
        recordingDir: result.archive.recordingDir,
      });
      res.json(TranscriptionResponseSchema.parse({ capture }));
    } catch (error) {
      await options.captureJournal
        .recordFailed({
          source: 'file',
          error: error instanceof Error ? error.message : '音频转写失败。',
        })
        .catch(() => undefined);
      sendAudioError(res, error);
    }
  });

  router.post('/transcription/archive', uploadAudio(), async (req, res) => {
    if (!req.file?.buffer?.length) {
      res.status(400).json({ error: '请在 audio 字段上传音频文件。', code: 'AUDIO_MISSING' });
      return;
    }
    const transcript = typeof req.body.transcript === 'string' ? req.body.transcript : '';
    try {
      const archive = await service.archiveRecognizedAudio(
        req.file.buffer,
        transcript,
        {
          mimetype: req.file.mimetype,
          size: req.file.size,
          originalname: req.file.originalname,
        },
        'realtime-stream',
      );
      const capture = await options.captureJournal.recordRecognized({
        source: 'realtime',
        transcript,
        recordingDir: archive.recordingDir,
      });
      res.json(TranscriptionResponseSchema.parse({ capture }));
    } catch (error) {
      await options.captureJournal
        .recordFailed({
          source: 'realtime',
          error: error instanceof Error ? error.message : '录音归档失败。',
        })
        .catch(() => undefined);
      sendAudioError(res, error);
    }
  });

  return router;
}
