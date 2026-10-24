import { z } from 'zod/v4';
import {
  MindMapChangeSetSchema,
  type MindMapChangeRequest,
  type MindMapChangeSet,
} from '../../../shared/mind-map';
import type { MindMapChangeProvider } from '../../modules/ai/change-provider';
import { compileMindMapChangePrompt } from '../../modules/ai/prompt/compiler';
import { createAIProviderError, normalizeAIProviderError } from './ai-errors';

const OllamaChatResponseSchema = z
  .object({ message: z.object({ content: z.string() }).passthrough() })
  .passthrough();
const OllamaTagsResponseSchema = z
  .object({ models: z.array(z.object({ name: z.string() }).passthrough()) })
  .passthrough();
const RELATION_TRANSPORT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'sourceId', 'targetId'],
  properties: {
    id: { type: 'string' },
    sourceId: { type: 'string' },
    targetId: { type: 'string' },
    label: { type: 'string', maxLength: 80 },
    dashed: { type: 'boolean' },
  },
} as const;
const GROUP_TRANSPORT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'label', 'memberIds'],
  properties: {
    id: { type: 'string' },
    label: { type: 'string' },
    memberIds: { type: 'array', items: { type: 'string' } },
  },
} as const;
// Expand a few tree levels into a finite grammar, not a recursive $ref. Deeper
// trees remain allowed and are validated by the canonical recursive Zod schema.
function nodeTransportSchema(depth: number): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'title', 'content', 'kind', 'status', 'source', 'children'],
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      content: { type: 'string' },
      kind: { enum: ['topic', 'task', 'idea', 'note', 'question', 'risk', 'resource', 'decision'] },
      status: { enum: ['open', 'done', 'later'] },
      source: { enum: ['user', 'summary', 'inference'] },
      children: {
        type: 'array',
        items: depth > 0 ? nodeTransportSchema(depth - 1) : { type: 'object' },
      },
      layoutDirection: { enum: ['left', 'right', 'up', 'down'] },
      layoutOrder: { type: 'number' },
      importance: { type: 'number', minimum: 0, maximum: 1 },
      relativePlacement: {
        type: 'object',
        additionalProperties: false,
        required: ['relativeTo', 'side'],
        properties: {
          relativeTo: { type: 'string' },
          side: { enum: ['left', 'right', 'above', 'below'] },
          distance: { type: 'number', minimum: 40, maximum: 1200 },
        },
      },
    },
  };
}
const NODE_TRANSPORT_SCHEMA = nodeTransportSchema(2);
// Ollama's grammar engine can become unstable with the recursive MindMapNode schema.
// This transport schema guarantees a JSON ChangeSet envelope; the canonical Zod schema
// below still validates every command and recursive node before anything is applied.
const CHANGE_SET_TRANSPORT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['baseRevision', 'summary', 'commands'],
  properties: {
    baseRevision: { type: 'integer', minimum: 0 },
    summary: { type: 'string' },
    navigation: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['nodeId', 'reason', 'nextStep'],
        properties: {
          nodeId: { type: 'string' },
          reason: { type: 'string' },
          nextStep: { type: 'string' },
        },
      },
    },
    commands: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        required: ['type'],
        properties: {
          document: {
            type: 'object',
            additionalProperties: false,
            required: ['title', 'root', 'relations', 'groups'],
            properties: {
              title: { type: 'string' },
              root: NODE_TRANSPORT_SCHEMA,
              relations: { type: 'array', items: RELATION_TRANSPORT_SCHEMA },
              groups: { type: 'array', items: GROUP_TRANSPORT_SCHEMA },
            },
          },
          relation: RELATION_TRANSPORT_SCHEMA,
          group: GROUP_TRANSPORT_SCHEMA,
          node: NODE_TRANSPORT_SCHEMA,
          type: {
            enum: [
              'replaceDocument',
              'addNode',
              'updateNode',
              'moveNode',
              'deleteNode',
              'upsertRelation',
              'deleteRelation',
              'upsertGroup',
              'deleteGroup',
            ],
          },
        },
      },
    },
  },
} as const;

export type OllamaFetch = (url: string, init?: RequestInit) => Promise<Response>;

function parseChangeSet(rawPayload: string): MindMapChangeSet {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPayload.trim()) as unknown;
  } catch {
    throw createAIProviderError({
      code: 'AI_BAD_RESPONSE',
      message: '本地模型返回了无效 JSON，无法应用导图变更。',
    });
  }
  const result = MindMapChangeSetSchema.safeParse(parsed);
  if (!result.success) {
    const error = createAIProviderError({
      code: 'AI_BAD_RESPONSE',
      message: '本地模型返回的 ChangeSet 不符合协议。',
    }) as Error & { issues?: unknown };
    error.issues = result.error.issues;
    throw error;
  }
  return result.data;
}

function normalizeModelName(name: string) {
  return name.trim().replace(/:latest$/i, '');
}

export class OllamaMindMapChangeProvider implements MindMapChangeProvider {
  private readonly baseUrl: string;
  private readonly request: OllamaFetch;

  constructor(
    private readonly options: {
      baseUrl: string;
      model: string;
      contextSize: number;
      timeoutMs?: number;
      debugMindMap?: boolean;
      fetch?: OllamaFetch;
    },
  ) {
    const url = new URL(options.baseUrl);
    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
    ) {
      throw new Error('Local AI provider only accepts a loopback HTTP URL.');
    }
    this.baseUrl = url.toString().replace(/\/+$/, '');
    this.request = options.fetch ?? fetch;
  }

  async isReady(): Promise<boolean> {
    try {
      const response = await this.request(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(1500),
      });
      if (!response.ok) return false;
      const payload = OllamaTagsResponseSchema.parse(await response.json());
      const expected = normalizeModelName(this.options.model);
      return payload.models.some((model) => normalizeModelName(model.name) === expected);
    } catch {
      return false;
    }
  }

  private async complete(
    request: MindMapChangeRequest,
    repair?: { rawPayload: string; issues: unknown },
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    const prompt = compileMindMapChangePrompt(request);
    const user = repair
      ? [
          prompt.user,
          '',
          '上一轮响应无效。只允许修复为协议内的 JSON；不要改变用户意图。',
          '保持已经正确的节点 ID、内容和来源不变，针对下面具体错误修正。自连线必须移除或改成两个不同且已有的节点；不得原样重复同一条无效关系。',
          '逐项补齐校验要求；尤其每个 root、分支和叶节点都必须显式包含 children 数组，叶节点使用 children:[]。',
          `校验问题：${JSON.stringify(repair.issues).slice(0, 6000)}`,
          `无效响应：${repair.rawPayload.slice(0, 12_000)}`,
        ].join('\n')
      : prompt.user;

    try {
      const response = await this.request(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.any([
          AbortSignal.timeout(this.options.timeoutMs ?? 120_000),
          ...(signal ? [signal] : []),
        ]),
        body: JSON.stringify({
          model: this.options.model,
          stream: false,
          think: false,
          keep_alive: '2m',
          format: CHANGE_SET_TRANSPORT_SCHEMA,
          messages: [
            {
              role: 'system',
              content: `${prompt.system}\n\n你是完全在本机运行的模型。只输出 JSON，不输出思考过程、Markdown 或解释。`,
            },
            { role: 'user', content: user },
          ],
          options: {
            temperature: repair ? 0 : 0.2,
            num_ctx: this.options.contextSize,
            num_predict: request.intent === 'live' ? 1200 : 3000,
          },
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw createAIProviderError({
          code: response.status === 404 ? 'AI_NOT_READY' : 'AI_SERVICE_ERROR',
          message:
            payload?.error ??
            (response.status === 404
              ? `本地模型 ${this.options.model} 未安装。`
              : '本地 Ollama 调用失败。'),
        });
      }
      return OllamaChatResponseSchema.parse(await response.json()).message.content.trim();
    } catch (error) {
      signal?.throwIfAborted();
      throw createAIProviderError(normalizeAIProviderError(error));
    }
  }

  async proposeChangeSet(
    request: MindMapChangeRequest,
    signal?: AbortSignal,
  ): Promise<MindMapChangeSet> {
    const firstRaw = await this.complete(request, undefined, signal);
    signal?.throwIfAborted();
    try {
      const result = parseChangeSet(firstRaw);
      if (this.options.debugMindMap) {
        console.log('[ollama changeset]', JSON.stringify(result, null, 2));
      }
      return result;
    } catch (firstError) {
      const details = firstError as Error & { issues?: unknown };
      const repairedRaw = await this.complete(
        request,
        {
          rawPayload: firstRaw,
          issues: details.issues ?? details.message,
        },
        signal,
      );
      signal?.throwIfAborted();
      try {
        const result = parseChangeSet(repairedRaw);
        if (this.options.debugMindMap) {
          console.log('[ollama repaired changeset]', JSON.stringify(result, null, 2));
        }
        return result;
      } catch (repairError) {
        const normalized = repairError as Error & {
          code?: string;
          issues?: unknown;
          rawPayload?: unknown;
        };
        normalized.rawPayload = repairedRaw;
        throw normalized;
      }
    }
  }
}
