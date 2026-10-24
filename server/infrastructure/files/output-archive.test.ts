import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalRecordingTitle, saveRecordingArchive } from './output-archive';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe('output archive', () => {
  it('creates a local title without calling an AI provider', () => {
    expect(createLocalRecordingTitle('我想整理下周旅行计划，预算三千')).toBe('整理下周旅行计划');
  });

  it('uses unique directories and preserves the detected extension', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'voice-mind-map-output-'));
    temporaryDirectories.push(baseDir);
    const input = {
      audioBuffer: Buffer.from('audio'),
      audioExtension: 'mp3',
      transcript: '整理项目计划',
      source: 'http-upload' as const,
      status: 'recognized' as const,
    };

    const [first, second] = await Promise.all([
      saveRecordingArchive(input, baseDir),
      saveRecordingArchive(input, baseDir),
    ]);

    expect(first.recordingDir).not.toBe(second.recordingDir);
    expect(first.audioPath.endsWith('recording.mp3')).toBe(true);
    const metadata = JSON.parse(await readFile(first.metadataPath, 'utf8')) as {
      audioFile: string;
    };
    expect(metadata.audioFile).toBe('recording.mp3');
  });
});
