import { afterEach, describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const ORIGINAL_ENV = { ...process.env };
const DEFAULT_FUNASR_PYTHON = 'dependencies/local/asr-venv/bin/python';

function setEnv(vars: Record<string, string | undefined>) {
  process.env = {
    ...ORIGINAL_ENV,
    AI_PROVIDER: undefined,
    REMOTE_AI_BASE_URL: undefined,
    REMOTE_AI_MODEL: undefined,
    REMOTE_AI_API_KEY: undefined,
    ...vars,
  };
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('loadEnv', () => {
  it('uses the local Ollama model by default', () => {
    setEnv({
      FUNASR_PYTHON: undefined,
      LOCAL_AI_BASE_URL: undefined,
      LOCAL_AI_CONTEXT: undefined,
      LOCAL_AI_MODEL: undefined,
    });

    const env = loadEnv();

    expect(env.provider).toBe('ollama');
    expect(env.localAiBaseUrl).toBe('http://127.0.0.1:11434');
    expect(env.localAiContext).toBe(16384);
    expect(env.localAiModel).toBe('qwen-q4kp');
    expect(env.funasrPython).toBe(DEFAULT_FUNASR_PYTHON);
    expect(env.funasrModel).toBe('paraformer-zh');
    expect(env.funasrVadModel).toBe('fsmn-vad');
    expect(env.funasrPuncModel).toBe('ct-punc');
  });

  it('supports an explicit local model and context size', () => {
    setEnv({
      LOCAL_AI_BASE_URL: 'http://127.0.0.1:8080',
      LOCAL_AI_CONTEXT: '16384',
      LOCAL_AI_MODEL: 'qwen-q4kp',
    });

    expect(loadEnv()).toMatchObject({
      localAiBaseUrl: 'http://127.0.0.1:8080',
      localAiContext: 16384,
      localAiModel: 'qwen-q4kp',
    });
  });

  it('parses false-like DEBUG_MINDMAP values as false', () => {
    setEnv({
      DEBUG_MINDMAP: 'false',
    });
    expect(loadEnv().debugMindMap).toBe(false);

    setEnv({
      DEBUG_MINDMAP: '0',
    });
    expect(loadEnv().debugMindMap).toBe(false);
  });

  it('rejects a remote AI base URL', () => {
    setEnv({ LOCAL_AI_BASE_URL: 'https://example.com' });

    expect(() => loadEnv()).toThrow(/loopback/i);
  });
});

describe('explicit cloud configuration', () => {
  it('accepts a separately configured API without changing the local endpoint', () => {
    setEnv({
      AI_PROVIDER: 'api',
      REMOTE_AI_BASE_URL: 'https://api.example.test/v1',
      REMOTE_AI_API_KEY: 'fixture-token',
      REMOTE_AI_MODEL: 'test-model',
    });
    expect(loadEnv()).toMatchObject({
      provider: 'api',
      remoteAiBaseUrl: 'https://api.example.test/v1',
      remoteAiModel: 'test-model',
    });
  });
  it('rejects missing cloud credentials and insecure cloud URLs', () => {
    setEnv({
      AI_PROVIDER: 'api',
      REMOTE_AI_BASE_URL: 'https://api.example.test/v1',
      REMOTE_AI_MODEL: 'test-model',
    });
    expect(() => loadEnv()).toThrow();
    setEnv({
      AI_PROVIDER: 'api',
      REMOTE_AI_BASE_URL: 'http://api.example.test/v1',
      REMOTE_AI_MODEL: 'test-model',
      REMOTE_AI_API_KEY: 'fixture-token',
    });
    expect(() => loadEnv()).toThrow();
  });
});
