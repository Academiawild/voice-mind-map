export type NormalizedAIError = {
  code: 'AI_NOT_READY' | 'AI_BAD_RESPONSE' | 'AI_SERVICE_ERROR';
  message: string;
  retryAfterSeconds?: number;
};

export function createAIProviderError(normalized: NormalizedAIError) {
  const error = new Error(normalized.message) as Error & NormalizedAIError;
  error.code = normalized.code;
  if (normalized.retryAfterSeconds !== undefined) {
    error.retryAfterSeconds = normalized.retryAfterSeconds;
  }
  return error;
}

function readCode(error: unknown) {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const candidate = error as { code?: unknown; error?: { code?: unknown } };
  if (typeof candidate.code === 'string') {
    return candidate.code;
  }

  if (typeof candidate.error?.code === 'string') {
    return candidate.error.code;
  }

  return undefined;
}

function readMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
  }

  return '';
}

export function normalizeAIProviderError(error: unknown): NormalizedAIError {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    const candidate = error as NormalizedAIError;
    if (
      candidate.code === 'AI_NOT_READY' ||
      candidate.code === 'AI_BAD_RESPONSE' ||
      candidate.code === 'AI_SERVICE_ERROR'
    ) {
      return candidate;
    }
  }

  const code = readCode(error)?.toLowerCase() ?? '';
  const message = readMessage(error).toLowerCase();

  if (
    (error instanceof Error && error.name === 'TimeoutError') ||
    code.includes('timeout') ||
    message.includes('timeout') ||
    message.includes('timed out')
  ) {
    return {
      code: 'AI_SERVICE_ERROR',
      message: '这次思考超时了，原有内容未改动。可以重试，或选一个更具体的念头继续。',
    };
  }

  if (message.includes('model') && (message.includes('not found') || message.includes('missing'))) {
    return {
      code: 'AI_NOT_READY',
      message: '配置的本地模型未安装，请检查 LOCAL_AI_MODEL。',
    };
  }

  if (message.includes('json') && (message.includes('parse') || message.includes('invalid'))) {
    return {
      code: 'AI_BAD_RESPONSE',
      message: 'AI 返回了无效 JSON，无法生成思维导图。',
    };
  }

  if (message.includes('did not contain a valid json object')) {
    return {
      code: 'AI_BAD_RESPONSE',
      message: 'AI 返回了无效 JSON，无法生成思维导图。',
    };
  }

  if (
    code.includes('connection') ||
    code.includes('timeout') ||
    message.includes('connection error') ||
    message.includes('connect timeout') ||
    message.includes('fetch failed') ||
    message.includes('timed out')
  ) {
    return {
      code: 'AI_SERVICE_ERROR',
      message: '无法连接本地 Ollama，请确认 Ollama 已启动。',
    };
  }

  return {
    code: 'AI_SERVICE_ERROR',
    message: '本地模型调用失败，请稍后重试。',
  };
}

export function isNormalizedAIError(error: unknown): error is Error & NormalizedAIError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  );
}
