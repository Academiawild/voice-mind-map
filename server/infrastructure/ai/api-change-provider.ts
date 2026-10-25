import {
  MindMapChangeSetSchema,
  type MindMapChangeRequest,
  type MindMapChangeSet,
} from '../../../shared/mind-map';
import type { MindMapChangeProvider } from '../../modules/ai/change-provider';
import { compileMindMapChangePrompt } from '../../modules/ai/prompt/compiler';
import { createAIProviderError } from './ai-errors';

export function validateRemoteAIBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Remote AI requires an HTTPS base URL without embedded credentials.');
  }
  if (/\/(chat\/completions|models|messages|responses)\/?$/.test(url.pathname)) {
    throw new Error('Use the API base URL, not an individual endpoint.');
  }
  return url.toString().replace(/\/+$/, '');
}

/** Explicitly selected cloud provider; credentials stay on the backend. */
export class ApiMindMapChangeProvider implements MindMapChangeProvider {
  private readonly baseUrl: string;
  private readonly request: typeof fetch;
  private readyUntil = 0;

  constructor(
    private readonly options: {
      baseUrl: string;
      apiKey: string;
      model: string;
      timeoutMs?: number;
      fetch?: typeof fetch;
    },
  ) {
    this.baseUrl = validateRemoteAIBaseUrl(options.baseUrl);
    if (!options.apiKey.trim() || !options.model.trim())
      throw new Error('Remote AI key and model are required.');
    this.request = options.fetch ?? fetch;
  }

  async isReady(): Promise<boolean> {
    if (Date.now() < this.readyUntil) return true;
    try {
      const response = await this.request(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.options.apiKey}` },
        signal: AbortSignal.timeout(8000),
        redirect: 'error',
      });
      if (!response.ok) return false;
      const payload = (await response.json()) as { data?: Array<{ id?: string }> };
      const ready = payload.data?.some((model) => model.id === this.options.model) ?? false;
      if (ready) this.readyUntil = Date.now() + 30_000;
      return ready;
    } catch {
      return false;
    }
  }

  private async complete(request: MindMapChangeRequest, signal?: AbortSignal, repair?: string) {
    signal?.throwIfAborted();
    const prompt = compileMindMapChangePrompt(request);
    try {
      const response = await this.request(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
        },
        redirect: 'error',
        signal: AbortSignal.any([
          AbortSignal.timeout(this.options.timeoutMs ?? 120_000),
          ...(signal ? [signal] : []),
        ]),
        body: JSON.stringify({
          model: this.options.model,
          stream: false,
          temperature: repair ? 0 : 0.2,
          max_tokens: request.intent === 'live' ? 1200 : 3000,
          messages: [
            {
              role: 'system',
              content: `${prompt.system}\n\n只输出完整 JSON ChangeSet。不要输出 Markdown、解释或思考过程。`,
            },
            {
              role: 'user',
              content: repair
                ? `${prompt.user}\n\n上次输出未通过协议校验。请修复为完整有效的 ChangeSet JSON，保持用户意图。所有节点包含 children，叶节点使用 []；关系只引用已有节点，不得自连。\n${repair}`
                : prompt.user,
            },
          ],
        }),
      });
      if (!response.ok) {
        throw createAIProviderError({
          code: [401, 403, 404].includes(response.status) ? 'AI_NOT_READY' : 'AI_SERVICE_ERROR',
          message: `在线模型调用失败（HTTP ${response.status}），请检查密钥、模型权限及额度。`,
        });
      }
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw createAIProviderError({
          code: 'AI_BAD_RESPONSE',
          message: '在线模型未返回有效文本。',
        });
      }
      return content.trim();
    } catch (error) {
      signal?.throwIfAborted();
      if (
        error instanceof Error &&
        'code' in error &&
        ['AI_NOT_READY', 'AI_BAD_RESPONSE', 'AI_SERVICE_ERROR'].includes(String(error.code))
      )
        throw error;
      throw createAIProviderError({
        code: 'AI_SERVICE_ERROR',
        message: '无法完成在线模型请求，请检查网络或稍后重试。',
      });
    }
  }

  async proposeChangeSet(
    request: MindMapChangeRequest,
    signal?: AbortSignal,
  ): Promise<MindMapChangeSet> {
    let raw = await this.complete(request, signal);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      signal?.throwIfAborted();
      try {
        return MindMapChangeSetSchema.parse(JSON.parse(raw));
      } catch {
        if (attempt === 1) break;
        raw = await this.complete(request, signal, raw.slice(0, 12000));
      }
    }
    throw createAIProviderError({
      code: 'AI_BAD_RESPONSE',
      message: '在线模型返回的导图变更未通过校验，原有导图未改动。',
    });
  }
}
