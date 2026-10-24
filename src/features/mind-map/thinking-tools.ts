import type { MindMapDocument, ThinkingEntry } from '../../../shared/mind-map';

export const THINKING_LENSES = [
  {
    id: 'priority',
    label: '排个先后',
    hint: '找出先想清哪件事，能带动更多事情',
    prompt:
      '请直接提出一个有主见的先后顺序：综合影响、紧迫性、前置依赖和启动成本，判断先推进什么能带动更多事情。把你的取舍理由和可立即开始的小动作写进 navigation，最推荐的放第一项。信息不全时可以给出说明了依据的暂定判断；区分真正的期限与推测。已完成、暂放的事情不再作为当前首选。这一轮以现有节点为入口，commands 使用空数组，只更新 navigation，不重新生成文档。',
  },
  {
    id: 'association',
    label: '大胆联想',
    hint: '跨过分类，找一个意料之外但说得通的联系',
    prompt:
      '请跳出已有分类，大胆寻找一个意料之外但能解释清楚的跨主题联系、共同模式或类比。把关键桥梁写成有解释的 relations，提出一个能验证这个联想的问题放进 navigation。联想使用 inference 和 dashed，不只是重复现有概括。',
  },
  {
    id: 'challenge',
    label: '挑战一下',
    hint: '指出一个可能卡住你的前提，并给出另一种解释',
    prompt:
      '请像一个有主见的思考伙伴，直接挑战材料里一个具体判断或隐含前提：指出它在哪里，给出有内容的反例或另一种解释，并提出一个可以区分这两种解释的小实验或具体问题。写进导图和 navigation，新增判断标为 inference。不要泛泛劝告，也不必先征求我是否愿意被挑战。',
  },
] as const;

// Presentation-only: preserve every node and suggestion in the stored document.
export function activeThinkingEntries(
  document: MindMapDocument | null,
  entries: ThinkingEntry[] = [],
) {
  const active = new Set<string>();
  const visit = (node: NonNullable<MindMapDocument>['root'], ancestorActive: boolean) => {
    const isActive = ancestorActive && node.status === 'open';
    if (isActive) active.add(node.id);
    node.children.forEach((child) => visit(child, isActive));
  };
  if (document) visit(document.root, true);
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (!active.has(entry.nodeId) || seen.has(entry.nodeId)) return false;
    seen.add(entry.nodeId);
    return true;
  });
}
