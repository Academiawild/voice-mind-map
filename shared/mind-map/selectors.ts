import type { MindMapDocument, MindMapNode } from './schema';

export function flattenMindMapNodes(document: MindMapDocument | null): MindMapNode[] {
  if (!document) {
    return [];
  }
  const nodes: MindMapNode[] = [];
  const visit = (node: MindMapNode) => {
    nodes.push(node);
    node.children.forEach(visit);
  };
  visit(document.root);
  return nodes;
}

export function findMindMapNodeById(
  document: MindMapDocument | null,
  nodeId: string | null,
): MindMapNode | null {
  if (!nodeId) {
    return null;
  }
  return flattenMindMapNodes(document).find((node) => node.id === nodeId) ?? null;
}

export function countMindMapNodes(document: MindMapDocument | null) {
  return flattenMindMapNodes(document).length;
}

export function collectSubtreeIds(node: MindMapNode, ids = new Set<string>()) {
  ids.add(node.id);
  node.children.forEach((child) => collectSubtreeIds(child, ids));
  return ids;
}

export function subtreeContainsUserSource(node: MindMapNode): boolean {
  return node.source === 'user' || node.children.some(subtreeContainsUserSource);
}
