export const COMMAND_PROTOCOL_PROMPT = `
只输出一个 JSON 对象，严格符合：
{
  "baseRevision": number,
  "summary": string,
  "commands": MindMapCommand[],
  "navigation": [{"nodeId":"最终文档内的节点ID","reason":"为什么可以从这里开始","nextStep":"一个具体的下一步"}]
}

允许的命令及唯一字段：
- {"type":"replaceDocument","document":{"title":"主题","root":{"id":"root","title":"主题","content":"","kind":"topic","status":"open","source":"summary","children":[]},"relations":[],"groups":[]}}
- {"type":"addNode","parentId":string,"node":MindMapNode}
- {"type":"updateNode","nodeId":string,"patch":MindMapNodePatch}
- {"type":"moveNode","nodeId":string,"newParentId":string}
- {"type":"deleteNode","nodeId":string}
- {"type":"upsertRelation","relation":MindMapRelation}
- {"type":"deleteRelation","relationId":string}
- {"type":"upsertGroup","group":MindMapGroup}
- {"type":"deleteGroup","groupId":string}

每一个 MindMapNode（包括 root、分支和叶节点）都必须显式包含且只能使用：id, title, content, kind, status, source, children，以及可选的 layoutDirection, layoutOrder, relativePlacement, importance。叶节点也绝不能省略 children，必须写成 "children":[]。
kind 只能是 topic | task | idea | note | question | risk | resource | decision。
status 只能是 open | done | later。所有新增节点都必须有全局唯一、稳定、可读的 ID。
MindMapRelation 唯一字段：id, sourceId, targetId, label（最多80字）, dashed（布尔值）。例如 {"id":"desire-stability","sourceId":"desire","targetId":"stability","label":"可能：追求新鲜感与稳定需要存在张力","dashed":true}。初始化时放在 document.relations；增量时使用 upsertRelation。
MindMapGroup 唯一字段：id, label, memberIds（节点ID数组）。navigation 最多3项，不把推荐顺序写成用户既定优先级。
不要输出 snake_case 命令、label/note/type 别名、Markdown、解释或额外字段。
`.trim();
