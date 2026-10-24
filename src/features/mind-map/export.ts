import type { MindMapDocument, MindMapNode } from '../../../shared/mind-map';

function nodeToMarkdown(node: MindMapNode, depth: number): string[] {
  const heading = `${'#'.repeat(Math.min(depth + 1, 6))} ${node.title}`;
  const lines = [heading];
  if (node.content.trim()) lines.push('', node.content.trim());
  lines.push('', `> 来源：${node.source} · 类型：${node.kind} · 状态：${node.status}`, '');
  for (const child of node.children) lines.push(...nodeToMarkdown(child, depth + 1));
  return lines;
}

export function mindMapToMarkdown(mindMap: MindMapDocument) {
  return nodeToMarkdown(mindMap.root, 0).join('\n').trimEnd();
}

export function downloadMindMapFile(mindMap: MindMapDocument, format: 'json' | 'markdown') {
  const content =
    format === 'json' ? `${JSON.stringify(mindMap, null, 2)}\n` : `${mindMapToMarkdown(mindMap)}\n`;
  const extension = format === 'json' ? 'json' : 'md';
  const type = format === 'json' ? 'application/json' : 'text/markdown';
  const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `voice-mind-map.${extension}`;
  anchor.click();
  URL.revokeObjectURL(url);
}
