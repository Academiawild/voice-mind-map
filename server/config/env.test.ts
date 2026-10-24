import { afterEach, describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const ORIGINAL_ENV = { ...process.env };
const DEFAULT_FUNASR_PYTHON = 'dependencies/local/asr-venv/bin/python';

function setEnv(vars: Record<string, string | undefined>) {
  process.env = {
    ...ORIGINAL_ENV,
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
