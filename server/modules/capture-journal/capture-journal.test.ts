import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CaptureJournalStore } from './capture-journal';

describe('CaptureJournalStore', () => {
  it('recovers recognized captures and removes organized captures from pending', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'capture-journal-'));
    const journalPath = path.join(directory, 'journal.json');
    const first = new CaptureJournalStore(journalPath);
    const capture = await first.recordRecognized({
      source: 'realtime',
      transcript: '恢复这段录音',
      recordingDir: path.join(directory, 'recording'),
    });
    await first.recordFailed({ source: 'file', error: '没有识别到语音' });

    const restarted = new CaptureJournalStore(journalPath);
    await expect(restarted.listPending()).resolves.toMatchObject([
      { id: capture.id, status: 'recognized', transcript: '恢复这段录音' },
    ]);
    await restarted.markOrganized(capture.id);
    await expect(restarted.listPending()).resolves.toEqual([]);
  });
});
