import { MindMapDocumentSchema, type MindMapDocument, type MindMapNode } from './schema';

function normalizeEvidence(value: string) {
  return value.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function isDirectlySupported(node: MindMapNode, userInput: string) {
  const evidence = normalizeEvidence(userInput);
  const candidates = [node.title, node.content]
    .map(normalizeEvidence)
    .filter((value) => value.length >= 2);
  return candidates.some((candidate) => evidence.includes(candidate));
}

/**
 * Treat `source: user` as protected provenance, not a style choice for the model.
 * Existing user facts retain that provenance; unsupported new claims are downgraded.
 */
export function enforceMindMapSourcePolicy(
  current: MindMapDocument | null,
  next: MindMapDocument,
  userInput: string,
): MindMapDocument {
  const currentSources = new Map<string, MindMapNode['source']>();
  const remember = (node: MindMapNode) => {
    currentSources.set(node.id, node.source);
    node.children.forEach(remember);
  };
  if (current) {
    remember(current.root);
  }

  const correct = (node: MindMapNode): MindMapNode => {
    const previousSource = currentSources.get(node.id);
    let source = node.source;
    if (previousSource === 'user') {
      source = 'user';
    } else if (source === 'user' && !isDirectlySupported(node, userInput)) {
      source = 'summary';
    }
    return { ...node, source, children: node.children.map(correct) };
  };

  return MindMapDocumentSchema.parse({ ...next, root: correct(next.root) });
}
