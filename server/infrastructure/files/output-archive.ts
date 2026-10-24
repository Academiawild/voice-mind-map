import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export type OutputSource = 'http-upload' | 'realtime-stream';

export type RecordingArchiveInput = {
  audioBuffer: Buffer;
  audioExtension: string;
  transcript: string;
  source: OutputSource;
  status: 'recognized';
  meta?: Record<string, string | number | boolean | undefined>;
};

export type TranscriptionLogEntry = {
  source: OutputSource;
  text: string;
  type?: 'partial' | 'final';
  meta?: Record<string, string | number | boolean | undefined>;
};

const OUTPUTS_DIR = resolve(process.cwd(), 'outputs');
const LOG_PATH = resolve(OUTPUTS_DIR, 'transcription-history.log');

function createTimestamp() {
  const now = new Date();
  const pad = (value: number, length = 2) => String(value).padStart(length, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
    '-',
    pad(now.getMilliseconds(), 3),
  ].join('');
}

function sanitizeFolderTitle(value: string) {
  return Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join('')
    .trim()
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '')
    .replace(/[.。]+$/g, '')
    .slice(0, 40);
}

export function createLocalRecordingTitle(transcript: string) {
  const firstClause = transcript
    .trim()
    .replace(/\s+/g, '')
    .split(/[，。；,.!?！？\n]/)[0]
    ?.replace(/^(今天|明天|后天|上午|下午|晚上|我们想|我们要|我想|我要|我们|我)/, '')
    .slice(0, 20);
  return sanitizeFolderTitle(firstClause ?? '') || '录音记录';
}

function sanitizeExtension(value: string) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalized || 'webm';
}

async function ensureOutputsDir() {
  await mkdir(OUTPUTS_DIR, { recursive: true });
}

export async function saveRecordingArchive(input: RecordingArchiveInput, baseDir = OUTPUTS_DIR) {
  await mkdir(baseDir, { recursive: true });

  const transcript = input.transcript.trim();
  if (!transcript) {
    throw new Error('Cannot archive a recording without a recognized transcript.');
  }

  const folderTitle = createLocalRecordingTitle(transcript);
  const createDirectory = async () => {
    const baseName = `${folderTitle}-${createTimestamp()}`;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const suffix = attempt === 0 ? '' : `-${attempt + 1}`;
      const recordingDir = resolve(baseDir, `${baseName}${suffix}`);
      try {
        await mkdir(recordingDir);
        return recordingDir;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw error;
        }
      }
    }
    throw new Error('无法创建唯一的录音保存目录。');
  };
  const recordingDir = await createDirectory();
  const extension = sanitizeExtension(input.audioExtension);
  const audioFile = `recording.${extension}`;
  const audioPath = resolve(recordingDir, audioFile);
  const transcriptPath = resolve(recordingDir, 'transcript.txt');
  const metadataPath = resolve(recordingDir, 'metadata.json');

  await writeFile(audioPath, input.audioBuffer);
  await writeFile(transcriptPath, transcript, 'utf8');
  await writeFile(
    metadataPath,
    `${JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        title: folderTitle,
        source: input.source,
        status: input.status,
        audioFile,
        transcriptFile: 'transcript.txt',
        transcript,
        meta: input.meta,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  return {
    recordingDir,
    audioPath,
    transcriptPath,
    metadataPath,
  };
}

export async function writeTranscriptionLog(entry: TranscriptionLogEntry) {
  const text = entry.text.trim();
  if (!text) {
    return;
  }

  await ensureOutputsDir();
  const payload = {
    timestamp: new Date().toISOString(),
    source: entry.source,
    type: entry.type,
    text,
    meta: entry.meta,
  };

  await appendFile(LOG_PATH, `${JSON.stringify(payload)}\n`, 'utf8');
}
