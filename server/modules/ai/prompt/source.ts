export const SOURCE_RULES_PROMPT = `
来源字段 source 是必填的严格枚举：
- user：用户本次输入直接陈述，或上下文中已有且必须保留的用户事实。
- summary：对用户材料的压缩、改写或归纳。
- inference：模型新增的推测、风险、可能性或建议。
不得把推测标为 user。不得输出旧值 ai。
`.trim();
