export const CANVAS_RULES_PROMPT = `
画布规则：
- 顶层分支可使用 layoutDirection: right | left | down | up；优先保持已有方向。
- layoutOrder 用于同方向排序；只有明确需要时才修改。
- relativePlacement 只引用已存在或同一 ChangeSet 中新增的节点 ID。
- importance 范围为 0 到 1。
- 不根据坐标批量搬动节点；坐标仅帮助理解用户已形成的布局偏好。
`.trim();
