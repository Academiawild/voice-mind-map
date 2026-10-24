import type { MindMapChangeRequest } from '../../../../shared/mind-map';

export function buildModeRules(request: MindMapChangeRequest) {
  if (!request.document) {
    return '当前是初始化：commands 必须只包含一个 replaceDocument，baseRevision 必须为 0。';
  }
  if (
    request.document.title === '新思维导图' &&
    request.document.root.id === 'root' &&
    request.document.root.children.length === 0 &&
    request.document.root.content.trim() === '' &&
    request.document.relations.length === 0 &&
    request.document.groups.length === 0
  ) {
    return '当前是空白默认导图：优先用一个 replaceDocument 初始化完整导图；也可以向 root 添加节点。';
  }
  if (request.intent === 'live') {
    return '当前是实时增量：优先低延迟、小批量 addNode/updateNode；不要删除和重构无关分支。';
  }
  if (request.selectedNodeId) {
    return `当前是聚焦整理：围绕节点 ${request.selectedNodeId} 回应本次输入，可联系其他分支。保留无关结构与用户布局。给出此处能继续推进的具体入口，禁止无授权整图替换。`;
  }
  if (request.intent === 'batch') {
    return '当前是批量整理：可以合并冗余与调整结构，但必须保留独有用户事实。';
  }
  return '当前是手动整理：做完整但克制的增量更新。禁止 replaceDocument；只使用精确 ID 的增量命令。';
}
