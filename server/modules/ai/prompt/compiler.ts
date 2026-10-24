import type {
  MindMapChangeRequest,
  MindMapDocument,
  MindMapNode,
} from '../../../../shared/mind-map';
import { CANVAS_RULES_PROMPT } from './canvas';
import { buildModeRules } from './modes';
import { ORGANIZING_POLICY_PROMPT } from './organizing';
import { COMMAND_PROTOCOL_PROMPT } from './protocol';
import { SOURCE_RULES_PROMPT } from './source';

function compactNode(node: MindMapNode): Record<string, unknown> {
  return {
    id: node.id,
    title: node.title,
    content: node.content,
    kind: node.kind,
    status: node.status,
    source: node.source,
    ...(node.layoutDirection ? { layoutDirection: node.layoutDirection } : {}),
    ...(node.layoutOrder !== undefined ? { layoutOrder: node.layoutOrder } : {}),
    ...(node.relativePlacement ? { relativePlacement: node.relativePlacement } : {}),
    ...(node.importance !== undefined ? { importance: node.importance } : {}),
    children: node.children.map(compactNode),
  };
}

function compactDocument(document: MindMapDocument | null) {
  if (!document) {
    return null;
  }
  return {
    schemaVersion: document.schemaVersion,
    revision: document.revision,
    title: document.title,
    root: compactNode(document.root),
    relations: document.relations,
    groups: document.groups,
  };
}

export type CompiledMindMapPrompt = { system: string; user: string };

export function compileMindMapChangePrompt(request: MindMapChangeRequest): CompiledMindMapPrompt {
  const system = [
    ORGANIZING_POLICY_PROMPT,
    SOURCE_RULES_PROMPT,
    CANVAS_RULES_PROMPT,
    COMMAND_PROTOCOL_PROMPT,
    buildModeRules(request),
  ].join('\n\n');
  const user = JSON.stringify(
    {
      task: '根据 input 提议 MindMapChangeSet。目标 ID 必须精确匹配，不允许按标题猜测。',
      input: request.input,
      intent: request.intent,
      baseRevision: request.document?.revision ?? 0,
      selectedNodeId: request.selectedNodeId,
      document: compactDocument(request.document),
      layoutPreferences: request.layoutPreferences,
      feedback: request.feedback.slice(-10),
    },
    null,
    2,
  );
  return { system, user };
}
