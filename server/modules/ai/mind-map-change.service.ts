import {
  MindMapChangeResponseSchema,
  MindMapChangeSetSchema,
  applyMindMapChangeSet,
  enforceMindMapSourcePolicy,
  findMindMapNodeById,
  guardMindMapChangeSet,
  type MindMapChangeRequest,
  type MindMapChangeResponse,
  type MindMapChangeSet,
} from '../../../shared/mind-map';
import { createAIProviderError } from '../../infrastructure/ai/ai-errors';
import type { MindMapChangeProvider } from './change-provider';

export class MindMapChangeService {
  constructor(private readonly provider: MindMapChangeProvider) {}

  private apply(request: MindMapChangeRequest, changeSet: MindMapChangeSet) {
    const guarded = guardMindMapChangeSet({
      current: request.document,
      changeSet,
      userInput: request.input,
      intent: request.intent,
    });
    const guardedChangeSet = {
      ...changeSet,
      commands: guarded.acceptedCommands,
    };
    const applied = applyMindMapChangeSet(request.document, guardedChangeSet, {
      allowReplace: guarded.allowReplace,
    });

    return {
      changeSet,
      applied,
      rejectedCommands: [...guarded.rejectedCommands, ...applied.rejectedCommands],
    };
  }

  private fallbackChangeSet(request: MindMapChangeRequest): MindMapChangeSet {
    const title = Array.from(request.input.trim()).slice(0, 32).join('') || '语音记录';
    if (!request.document) {
      return MindMapChangeSetSchema.parse({
        baseRevision: 0,
        summary: 'AI 命令未能安全应用，已保存原始内容。',
        commands: [
          {
            type: 'replaceDocument',
            document: {
              title,
              root: {
                id: 'root',
                title,
                content: request.input,
                kind: 'topic',
                status: 'open',
                source: 'user',
                children: [],
              },
              relations: [],
              groups: [],
            },
          },
        ],
      });
    }

    const baseId = `capture-${request.document.revision + 1}`;
    let nodeId = baseId;
    let suffix = 2;
    while (findMindMapNodeById(request.document, nodeId)) {
      nodeId = `${baseId}-${suffix}`;
      suffix += 1;
    }
    return MindMapChangeSetSchema.parse({
      baseRevision: request.document.revision,
      summary: 'AI 命令未能安全应用，已保存原始内容。',
      commands: [
        {
          type: 'addNode',
          parentId: request.document.root.id,
          node: {
            id: nodeId,
            title,
            content: request.input,
            kind: 'note',
            status: 'open',
            source: 'user',
            children: [],
          },
        },
      ],
    });
  }

  async change(
    request: MindMapChangeRequest,
    signal?: AbortSignal,
  ): Promise<MindMapChangeResponse> {
    signal?.throwIfAborted();
    // First validation boundary: no provider value enters the application unparsed.
    const firstChangeSet = MindMapChangeSetSchema.parse(
      await this.provider.proposeChangeSet(request, signal),
    );
    signal?.throwIfAborted();
    let result = this.apply(request, firstChangeSet);

    if (result.applied.appliedCommands.length === 0 && result.rejectedCommands.length > 0) {
      const retryFeedback = result.rejectedCommands
        .map(({ code, reason }) => `${code}: ${reason}`)
        .join('; ');
      const retryRequest: MindMapChangeRequest = {
        ...request,
        feedback: [
          ...request.feedback,
          `上一轮命令全部被安全规则拒绝。请根据当前 document 的精确节点 ID 重新生成，不要重复错误。${retryFeedback}`,
        ].slice(-30),
      };
      const retryChangeSet = MindMapChangeSetSchema.parse(
        await this.provider.proposeChangeSet(retryRequest, signal),
      );
      signal?.throwIfAborted();
      result = this.apply(request, retryChangeSet);
    }

    if (result.applied.appliedCommands.length === 0 && result.rejectedCommands.length > 0) {
      result = this.apply(request, this.fallbackChangeSet(request));
    }

    if (!result.applied.document) {
      const error = createAIProviderError({
        code: 'AI_BAD_RESPONSE',
        message: 'AI 没有生成可初始化思维导图的有效命令。',
      }) as Error & { issues?: unknown };
      error.issues = result.rejectedCommands;
      throw error;
    }

    const document = enforceMindMapSourcePolicy(
      request.document,
      result.applied.document,
      request.input,
    );
    // Second validation boundary: commands are applied deterministically, then the full
    // response (including the resulting document) is checked before it leaves the server.
    return MindMapChangeResponseSchema.parse({
      document,
      changeSet: {
        ...result.changeSet,
        navigation: (result.changeSet.navigation ?? []).filter((entry) =>
          findMindMapNodeById(document, entry.nodeId),
        ),
      },
      appliedCommands: result.applied.appliedCommands,
      rejectedCommands: result.rejectedCommands,
    });
  }
}
