import { describe, expect, it } from 'vitest';
import { MindMapChangeRequestSchema } from '../../../../shared/mind-map';
import { compileMindMapChangePrompt } from './compiler';

describe('compileMindMapChangePrompt', () => {
  it('uses one ChangeSet protocol for initialization and excludes legacy aliases', () => {
    const prompt = compileMindMapChangePrompt(
      MindMapChangeRequestSchema.parse({
        input: '记录我的产品想法',
        document: null,
      }),
    );
    expect(prompt.system).toContain('replaceDocument');
    expect(prompt.system).toContain('baseRevision');
    expect(prompt.system).toContain('source');
    expect(prompt.system).toContain('不得输出旧值 ai');
    expect(prompt.system).toContain('初始化');
    expect(prompt.user).toContain('"baseRevision": 0');
  });
});
