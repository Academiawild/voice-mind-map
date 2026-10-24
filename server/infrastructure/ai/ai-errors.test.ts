import { describe, expect, it } from 'vitest';
import { createAIProviderError, normalizeAIProviderError } from './ai-errors';

describe('normalizeAIProviderError', () => {
  it('recognizes a missing local model', () => {
    const normalized = normalizeAIProviderError({
      message: 'model qwythos-9b not found',
    });

    expect(normalized.code).toBe('AI_NOT_READY');
  });

  it('preserves normalized errors', () => {
    const error = createAIProviderError({
      code: 'AI_BAD_RESPONSE',
      message: 'AI 返回了无效 JSON，无法生成思维导图。',
    });

    expect(normalizeAIProviderError(error)).toMatchObject({
      code: 'AI_BAD_RESPONSE',
      message: 'AI 返回了无效 JSON，无法生成思维导图。',
    });
  });

  it('reports local connection failures clearly', () => {
    const normalized = normalizeAIProviderError({
      code: 'APIConnectionError',
      message: 'Connection error.',
    });

    expect(normalized).toMatchObject({
      code: 'AI_SERVICE_ERROR',
      message: '无法连接本地 Ollama，请确认 Ollama 已启动。',
    });
  });

  it('distinguishes slow inference from a disconnected service', () => {
    expect(
      normalizeAIProviderError(
        new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
      ).message,
    ).toContain('思考超时');
  });
});
