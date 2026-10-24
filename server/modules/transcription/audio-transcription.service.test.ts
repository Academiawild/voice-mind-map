import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AudioInputError,
  detectSupportedAudioFormat,
  AudioTranscriptionService,
} from './audio-transcription.service';

const VALID_WEBM_PREFIX = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
const VALID_WEBM_BUFFER = Buffer.concat([VALID_WEBM_PREFIX, Buffer.alloc(1200, 0)]);
const THREE_GP_M4A_BUFFER = Buffer.concat([
  Buffer.from('0000001866747970336770340000000069736f6d33677034', 'hex'),
  Buffer.alloc(1200, 0),
]);
const WAV_BUFFER = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.alloc(4),
  Buffer.from('WAVEfmt '),
  Buffer.alloc(1200),
]);

function createService() {
  return new AudioTranscriptionService({
    archiveRecording: vi.fn(async () => ({
      recordingDir: 'test',
      audioPath: 'test/audio',
      transcriptPath: 'test/transcript',
      metadataPath: 'test/metadata',
    })),
    logTranscription: vi.fn(async () => undefined),
  });
}

describe('audio-transcription.service', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rejects tiny uploads before calling FunASR', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const service = createService();

    await expect(service.transcribeAudio(Buffer.alloc(999))).rejects.toMatchObject({
      message: '录音文件太小，可能没有录到声音。',
      code: 'AUDIO_TOO_SMALL',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects unsupported uploads before calling FunASR', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const service = createService();

    await expect(service.transcribeAudio(Buffer.alloc(1200, 0x01))).rejects.toBeInstanceOf(
      AudioInputError,
    );
    await expect(service.transcribeAudio(Buffer.alloc(1200, 0x01))).rejects.toMatchObject({
      code: 'UNSUPPORTED_AUDIO_FORMAT',
      status: 415,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('detects supported WebM and WAV containers', async () => {
    await expect(detectSupportedAudioFormat(VALID_WEBM_BUFFER)).resolves.toMatchObject({
      extension: 'webm',
    });
    await expect(detectSupportedAudioFormat(WAV_BUFFER)).resolves.toMatchObject({
      extension: 'wav',
    });
  });

  it('accepts M4A recordings that use a 3GP container', async () => {
    await expect(detectSupportedAudioFormat(THREE_GP_M4A_BUFFER)).resolves.toMatchObject({
      extension: '3gp',
      mimeType: 'video/3gpp',
    });
  });

  it('maps upstream ffmpeg errors to a clearer message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: 'ffmpeg conversion failed: invalid input',
            }),
            {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
      ),
    );
    const service = createService();

    await expect(service.transcribeAudio(VALID_WEBM_BUFFER)).rejects.toMatchObject({
      message: '音频格式转换失败：文件可能已损坏或格式不受支持。',
    });
  });

  it('does not archive empty recognition results', async () => {
    const archiveRecording = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ text: '' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );
    const service = new AudioTranscriptionService({
      archiveRecording,
      logTranscription: vi.fn(async () => undefined),
    });

    await expect(service.transcribeAudio(VALID_WEBM_BUFFER)).rejects.toMatchObject({
      code: 'NO_SPEECH',
      status: 422,
    });
    expect(archiveRecording).not.toHaveBeenCalled();
  });

  it('returns recognized text and archives successful audio', async () => {
    const archiveRecording = vi.fn(async () => ({
      recordingDir: 'test',
      audioPath: 'test/audio',
      transcriptPath: 'test/transcript',
      metadataPath: 'test/metadata',
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ text: '测试转写' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );
    const service = new AudioTranscriptionService({
      archiveRecording,
      logTranscription: vi.fn(async () => undefined),
    });

    await expect(service.transcribeAudio(VALID_WEBM_BUFFER)).resolves.toBe('测试转写');
    expect(archiveRecording).toHaveBeenCalledOnce();
  });
});
