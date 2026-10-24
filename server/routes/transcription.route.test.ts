// @vitest-environment node
import { createServer } from 'node:http';
import express from 'express';
import { expect, it, vi } from 'vitest';
import { createTranscriptionRouter } from './transcription.route';
import type { AudioTranscriptionService } from '../modules/transcription/audio-transcription.service';
import type { CaptureJournalStore } from '../modules/capture-journal/capture-journal';

it.each(['file', 'archive'])(
  'accepts audio larger than 20 MB on %s',
  async (route) => {
    const archive = { recordingDir: '/tmp/test-recording' };
    const transcribe = vi.fn().mockResolvedValue({ text: '测试转写', archive });
    const save = vi.fn().mockResolvedValue(archive);
    const service = {
      transcribeAudioWithArchive: transcribe,
      archiveRecognizedAudio: save,
    } as unknown as AudioTranscriptionService;
    const capture = {
      id: 'ab9d8c72-d0e5-4bb6-a8bf-174496881e5b',
      source: route === 'file' ? 'file' : 'realtime',
      status: 'recognized',
      transcript: '测试转写',
      recordingDir: archive.recordingDir,
      createdAt: '2026-10-24T00:00:00Z',
      updatedAt: '2026-10-24T00:00:00Z',
    };
    const journal = {
      recordRecognized: vi.fn().mockResolvedValue(capture),
      recordFailed: vi.fn().mockResolvedValue(undefined),
    } as unknown as CaptureJournalStore;
    const app = express();
    app.use('/api', createTranscriptionRouter(service, { captureJournal: journal }));
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No port');
      const form = new FormData();
      form.append('audio', new Blob([new Uint8Array(21 * 1024 * 1024)]), 'large.wav');
      if (route === 'archive') form.append('transcript', '测试转写');
      const response = await fetch(`http://127.0.0.1:${address.port}/api/transcription/${route}`, {
        method: 'POST',
        body: form,
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ capture });
      const handler = route === 'file' ? transcribe : save;
      expect(handler.mock.calls[0][0].length).toBe(21 * 1024 * 1024);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
  15_000,
);
