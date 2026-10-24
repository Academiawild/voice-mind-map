import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MindMapDocumentSchema } from '../../../shared/mind-map';
import { ThinkingDesk } from './thinking-desk';
import { activeThinkingEntries } from './thinking-tools';

const document = MindMapDocumentSchema.parse({
  schemaVersion: 2,
  revision: 1,
  title: '正在想的事情',
  root: {
    id: 'root',
    title: '正在想的事情',
    content: '',
    kind: 'topic',
    source: 'summary',
    status: 'open',
    children: [
      {
        id: 'work',
        title: '工作选择',
        content: '探索一条新的路',
        kind: 'question',
        source: 'user',
        status: 'open',
        children: [
          {
            id: 'stable',
            title: '什么需要稳定',
            content: '每个月的时间和收入',
            kind: 'question',
            source: 'inference',
            status: 'open',
            children: [],
          },
        ],
      },
      {
        id: 'learn',
        title: '学习原理',
        content: 'Transformer 与梯度下降',
        kind: 'question',
        source: 'user',
        status: 'open',
        children: [],
      },
    ],
  },
  relations: [],
  groups: [],
});
const navigation = [
  { nodeId: 'work', reason: '先确定选择标准', nextStep: '写下最想改变的一件事' },
  { nodeId: 'learn', reason: '一个独立的探索方向', nextStep: '从一个小例子开始' },
  { nodeId: 'stable', reason: '找到前提', nextStep: '比较收入和时间' },
];
const props = () => ({
  document,
  navigation,
  selectedNodeId: null,
  busy: false,
  onFocus: vi.fn(),
  onCompose: vi.fn(),
  onExplore: vi.fn(),
});
afterEach(cleanup);

describe('thinking desk', () => {
  it('offers a human answer without calling AI and lets the user choose another entry', async () => {
    const callbacks = props();
    render(<ThinkingDesk {...callbacks} />);
    await userEvent.click(screen.getByRole('button', { name: '我来想一想 ↙' }));
    expect(callbacks.onFocus).toHaveBeenCalledWith('work');
    expect(callbacks.onCompose).toHaveBeenCalledWith(
      expect.stringContaining(navigation[0].nextStep),
    );
    expect(callbacks.onExplore).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '切入点 2：学习原理' }));
    expect(screen.getByText('从一个小例子开始')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '一起推演 ↗' }));
    expect(callbacks.onExplore).toHaveBeenCalledWith(
      expect.stringContaining('从一个小例子开始'),
      'learn',
    );
  });

  it('searches nested content, keeps an empty result useful, and clears with Escape', async () => {
    const callbacks = props();
    render(<ThinkingDesk {...callbacks} />);
    const search = screen.getByRole('textbox', { name: '找一个念头' });
    await userEvent.type(search, '收入');
    expect(screen.getByRole('button', { name: /什么需要稳定/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /学习原理.*问题/ })).toBeNull();
    await userEvent.clear(search);
    await userEvent.type(search, '新念头');
    await userEvent.click(screen.getByRole('button', { name: '把它记下来 ↙' }));
    expect(callbacks.onCompose).toHaveBeenCalledWith('新念头');
    await userEvent.click(search);
    await userEvent.keyboard('{Escape}');
    expect(screen.getByText('摊开来看看')).toBeTruthy();
  });

  it('stops suggesting paused branches without discarding their suggestions', () => {
    const paused = structuredClone(document);
    paused.root.children[0].status = 'later';
    expect(activeThinkingEntries(paused, navigation).map((entry) => entry.nodeId)).toEqual([
      'learn',
    ]);
    expect(navigation).toHaveLength(3);
    paused.root.children[0].status = 'open';
    expect(activeThinkingEntries(paused, navigation)).toHaveLength(3);
  });

  it('still allows writing an answer when the model is busy', async () => {
    const callbacks = props();
    render(<ThinkingDesk {...callbacks} busy />);
    expect((screen.getByRole('button', { name: '一起推演 ↗' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await userEvent.click(screen.getByRole('button', { name: '我来想一想 ↙' }));
    expect(callbacks.onCompose).toHaveBeenCalledOnce();
  });

  it('gives parked thoughts room instead of immediately asking to rank them again', () => {
    const paused = structuredClone(document);
    paused.root.children.forEach((node) => {
      node.status = 'later';
    });
    render(<ThinkingDesk {...props()} document={paused} />);
    expect(screen.getByText('眼前的事，先安放好了。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '帮我选个起点 ↗' })).toBeNull();
  });

  it('shows the new first recommendation after a fresh ranking', async () => {
    const callbacks = props();
    const { rerender } = render(<ThinkingDesk {...callbacks} />);
    await userEvent.click(screen.getByRole('button', { name: '切入点 2：学习原理' }));
    expect(screen.getByText('从一个小例子开始')).toBeTruthy();
    rerender(<ThinkingDesk {...callbacks} navigation={[...navigation]} />);
    expect(screen.getByText('写下最想改变的一件事')).toBeTruthy();
  });
});
