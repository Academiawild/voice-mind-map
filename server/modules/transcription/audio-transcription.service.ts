import { fileTypeFromBuffer } from 'file-type';
import {
  saveRecordingArchive,
  type OutputSource,
  type RecordingArchiveInput,
  writeTranscriptionLog,
} from '../../infrastructure/files/output-archive';

type ArchiveRecording = (input: RecordingArchiveInput) => Promise<{
  recordingDir: string;
  audioPath: string;
  transcriptPath: string;
  metadataPath: string;
}>;

type WriteTranscriptionLog = typeof writeTranscriptionLog;

type AudioTranscriptionOptions = {
  serviceUrl?: string;
  healthUrl?: string;
  archiveRecording?: ArchiveRecording;
  logTranscription?: WriteTranscriptionLog;
};

type AsrResponse = {
  text?: string;
  error?: string;
};

export type UploadedAudioMeta = {
  mimetype?: string;
  size?: number;
  originalname?: string;
};

export type SupportedAudioFormat = {
  extension: 'webm' | 'wav' | 'mp3' | 'm4a' | 'aac' | 'ogg' | 'flac' | 'mp4' | '3gp' | '3g2';
  mimeType: string;
};

const DEFAULT_ASR_SERVICE_URL = 'http://127.0.0.1:10096/transcribe';
const DEFAULT_ASR_HEALTH_URL = 'http://127.0.0.1:10096/docs';
const ASR_SERVICE_OFFLINE_MESSAGE = '本地语音转写服务尚未就绪，请稍后再试。';
const MIN_AUDIO_BYTES = 1000;
const FFMPEG_CONVERSION_ERROR_MESSAGE = '音频格式转换失败：文件可能已损坏或格式不受支持。';
const NO_SPEECH_RECOGNIZED_MESSAGE = '没有识别到语音，请确认音频中有清晰人声。';
const UNSUPPORTED_AUDIO_MESSAGE =
  '不支持这个音频格式。支持 WebM、WAV、MP3、M4A、AAC、OGG、FLAC 和 MP4。';

const SUPPORTED_FORMATS: Record<string, SupportedAudioFormat> = {
  webm: { extension: 'webm', mimeType: 'audio/webm' },
  wav: { extension: 'wav', mimeType: 'audio/wav' },
  mp3: { extension: 'mp3', mimeType: 'audio/mpeg' },
  m4a: { extension: 'm4a', mimeType: 'audio/mp4' },
  aac: { extension: 'aac', mimeType: 'audio/aac' },
  ogg: { extension: 'ogg', mimeType: 'audio/ogg' },
  oga: { extension: 'ogg', mimeType: 'audio/ogg' },
  flac: { extension: 'flac', mimeType: 'audio/flac' },
  mp4: { extension: 'mp4', mimeType: 'video/mp4' },
  '3gp': { extension: '3gp', mimeType: 'video/3gpp' },
  '3g2': { extension: '3g2', mimeType: 'video/3gpp2' },
};

export class AudioInputError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = 'INVALID_AUDIO') {
    super(message);
    this.name = 'AudioInputError';
    this.status = status;
    this.code = code;
  }
}

function getReadableError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function normalizeUpstreamError(message: string) {
  const trimmed = message.trim();
  if (!trimmed) {
    return '音频转写失败。';
  }

  if (trimmed.toLowerCase().includes('ffmpeg conversion failed')) {
    return FFMPEG_CONVERSION_ERROR_MESSAGE;
  }

  return trimmed;
}

async function parseResponse(response: Response): Promise<AsrResponse> {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as AsrResponse;
  } catch {
    return { error: text };
  }
}

export async function detectSupportedAudioFormat(
  audioBuffer: Buffer,
): Promise<SupportedAudioFormat> {
  const bytes = Uint8Array.from(audioBuffer);
  const detected = await fileTypeFromBuffer(bytes);
  const supported = detected ? SUPPORTED_FORMATS[detected.ext.toLowerCase()] : undefined;
  if (supported) {
    return supported;
  }

  if (
    audioBuffer.length >= 4 &&
    audioBuffer[0] === 0x1a &&
    audioBuffer[1] === 0x45 &&
    audioBuffer[2] === 0xdf &&
    audioBuffer[3] === 0xa3
  ) {
    return SUPPORTED_FORMATS.webm;
  }

  throw new AudioInputError(UNSUPPORTED_AUDIO_MESSAGE, 415, 'UNSUPPORTED_AUDIO_FORMAT');
}

export class AudioTranscriptionService {
  private readonly serviceUrl: string;
  private readonly healthUrl: string;
  private readonly archiveRecording: ArchiveRecording;
  private readonly logTranscription: WriteTranscriptionLog;

  constructor(options: AudioTranscriptionOptions = {}) {
    this.serviceUrl = options.serviceUrl ?? DEFAULT_ASR_SERVICE_URL;
    this.healthUrl = options.healthUrl ?? DEFAULT_ASR_HEALTH_URL;
    this.archiveRecording = options.archiveRecording ?? saveRecordingArchive;
    this.logTranscription = options.logTranscription ?? writeTranscriptionLog;
  }

  async isReady() {
    try {
      const response = await fetch(this.healthUrl, {
        signal: AbortSignal.timeout(1200),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async archiveRecognizedAudio(
    audioBuffer: Buffer,
    transcript: string,
    meta: UploadedAudioMeta,
    source: OutputSource,
  ) {
    const text = transcript.trim();
    if (!text) {
      throw new AudioInputError('只有识别成功的录音才会保存。', 400, 'EMPTY_TRANSCRIPT');
    }

    const format = await detectSupportedAudioFormat(audioBuffer);
    return this.archiveRecording({
      audioBuffer,
      audioExtension: format.extension,
      source,
      status: 'recognized',
      transcript: text,
      meta: {
        mimetype: meta.mimetype,
        detectedMimeType: format.mimeType,
        size: meta.size ?? audioBuffer.length,
        originalname: meta.originalname,
      },
    });
  }

  async transcribeAudioWithArchive(audioBuffer: Buffer, meta: UploadedAudioMeta = {}) {
    if (!audioBuffer.length) {
      throw new AudioInputError('上传的音频为空。', 400, 'EMPTY_AUDIO');
    }

    if (audioBuffer.length < MIN_AUDIO_BYTES) {
      throw new AudioInputError('录音文件太小，可能没有录到声音。', 400, 'AUDIO_TOO_SMALL');
    }

    const format = await detectSupportedAudioFormat(audioBuffer);
    const formData = new FormData();
    const audioBytes = new Uint8Array(audioBuffer);
    formData.append(
      'audio',
      new Blob([audioBytes], { type: format.mimeType }),
      `upload.${format.extension}`,
    );

    let response: Response;
    try {
      response = await fetch(this.serviceUrl, {
        method: 'POST',
        body: formData,
      });
    } catch (error) {
      throw new Error(`${ASR_SERVICE_OFFLINE_MESSAGE} (${getReadableError(error)})`, {
        cause: error,
      });
    }

    const payload = await parseResponse(response);
    if (!response.ok) {
      throw new Error(normalizeUpstreamError(payload.error ?? ''));
    }

    if (!payload.text?.trim()) {
      throw new AudioInputError(NO_SPEECH_RECOGNIZED_MESSAGE, 422, 'NO_SPEECH');
    }

    const transcript = payload.text.trim();
    const archive = await this.archiveRecognizedAudio(audioBuffer, transcript, meta, 'http-upload');
    await this.logTranscription({
      source: 'http-upload',
      type: 'final',
      text: transcript,
      meta: {
        mimetype: meta.mimetype,
        detectedMimeType: format.mimeType,
        size: meta.size ?? audioBuffer.length,
        originalname: meta.originalname,
      },
    });

    return { text: transcript, archive };
  }

  async transcribeAudio(audioBuffer: Buffer, meta: UploadedAudioMeta = {}): Promise<string> {
    return (await this.transcribeAudioWithArchive(audioBuffer, meta)).text;
  }
}
