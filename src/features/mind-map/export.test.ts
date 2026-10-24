import { describe, expect, it } from 'vitest';
import type { MindMapDocument } from '../../../shared/mind-map';
import { mindMapToMarkdown } from './export';

const document: MindMapDocument = {
  schemaVersion: 2,
  revision: 3,
  title: '发布计划',
  root: {
    id: 'root',
    title: '发布计划',
    content: '准备本地版本',
    kind: 'topic',
    status: 'open',
    source: 'user',
    children: [
      {
        id: 'test',
        title: '测试',
        content: '跑完整门禁',
        kind: 'task',
        status: 'done',
        source: 'summary',
        children: [],
      },
    ],
  },
  relations: [],
  groups: [],
};

describe('mindMapToMarkdown', () => {
  it('exports the canonical node hierarchy with provenance', () => {
    expect(mindMapToMarkdown(document)).toContain(
      '# 发布计划\n\n准备本地版本\n\n> 来源：user · 类型：topic · 状态：open',
    );
    expect(mindMapToMarkdown(document)).toContain(
      '## 测试\n\n跑完整门禁\n\n> 来源：summary · 类型：task · 状态：done',
    );
  });
});
