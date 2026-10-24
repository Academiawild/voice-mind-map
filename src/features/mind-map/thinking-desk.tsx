import { useLayoutEffect, useMemo, useRef } from 'react';
import {
  findMindMapNodeById,
  flattenMindMapNodes,
  type MindMapDocument,
  type MindMapNode,
  type ThinkingEntry,
} from '../../../shared/mind-map';
import { activeThinkingEntries, THINKING_LENSES } from './thinking-tools';
import { useThinkingDeskMemory, type ThinkingDeskMemory } from './thinking-desk-memory';

type ThinkingDeskProps = {
  document: MindMapDocument | null;
  navigation?: ThinkingEntry[];
  selectedNodeId: string | null;
  busy: boolean;
  onFocus: (id: string | null) => void;
  onCompose: (text: string) => void;
  onExplore: (text: string, id: string | null) => void;
  memory?: ThinkingDeskMemory;
};

const kindLabels = {
  topic: '主题',
  task: '行动',
  idea: '念头',
  note: '片段',
  question: '问题',
  risk: '顾虑',
  resource: '线索',
  decision: '判断',
};

function ThoughtButton({
  node,
  selected,
  onFocus,
}: {
  node: MindMapNode;
  selected: boolean;
  onFocus: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className={`desk-thought status-${node.status} ${selected ? 'is-selected' : ''}`}
      aria-pressed={selected}
      onClick={() => onFocus(node.id)}
    >
      <span className={`desk-thought-mark source-${node.source}`} aria-hidden="true" />
      <span className="desk-thought-copy">
        <strong>{node.title}</strong>
        {node.content && <span>{node.content}</span>}
      </span>
      <small>
        {node.status === 'done'
          ? '已理清'
          : node.status === 'later'
            ? '暂放'
            : kindLabels[node.kind]}
      </small>
    </button>
  );
}

function ThoughtBranch({
  node,
  selectedNodeId,
  onFocus,
}: {
  node: MindMapNode;
  selectedNodeId: string | null;
  onFocus: (id: string) => void;
}) {
  return (
    <li>
      <ThoughtButton node={node} selected={node.id === selectedNodeId} onFocus={onFocus} />
      {node.children.length > 0 && (
        <ul className="desk-nested-thoughts">
          {node.children.map((child) => (
            <ThoughtBranch
              key={child.id}
              node={child}
              selectedNodeId={selectedNodeId}
              onFocus={onFocus}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function ThinkingDesk(props: ThinkingDeskProps) {
  const localMemory = useThinkingDeskMemory();
  const {
    query,
    setQuery,
    choice: entryChoice,
    setChoice: setEntryChoice,
    getScrollPosition,
    rememberScroll,
  } = props.memory ?? localMemory;
  const scroller = useRef<HTMLElement>(null);
  const hasDocument = Boolean(props.document);
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = getScrollPosition(query);
  }, [getScrollPosition, query, hasDocument]);
  const entries = activeThinkingEntries(props.document, props.navigation);
  const entry =
    entries.find(
      (item) => entryChoice?.navigation === props.navigation && item.nodeId === entryChoice?.nodeId,
    ) ?? entries[0];
  const entryNode = entry ? findMindMapNodeById(props.document, entry.nodeId) : null;
  const allNodes = useMemo(() => flattenMindMapNodes(props.document), [props.document]);
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const results = terms.length
    ? allNodes.filter((node) =>
        terms.every((term) => `${node.title}\n${node.content}`.toLocaleLowerCase().includes(term)),
      )
    : [];
  const branches = props.document
    ? props.document.root.children.length
      ? props.document.root.children
      : [props.document.root]
    : [];
  const hasOpenBranch =
    props.document?.root.status === 'open' && branches.some((node) => node.status === 'open');

  if (!props.document) {
    return (
      <section className="thinking-desk desk-empty" aria-label="思路桌面">
        <div className="desk-empty-art" aria-hidden="true">
          <span>一件在意的事</span>
          <i>↗</i>
          <span>另一个念头</span>
          <i>↘</i>
          <span>下一步</span>
        </div>
        <span className="desk-eyebrow">留一点空间，给还没成形的想法</span>
        <h2>开始整理你的想法</h2>
        <p>
          把脑子里占着位置的事情放下来。
          <br />
          一起看看，什么牵动着什么，先从哪里开始。
        </p>
        <button type="button" className="desk-primary" onClick={() => props.onCompose('')}>
          写下第一个念头 <span>↙</span>
        </button>
        <small>也可以直接说，或一次粘贴整段笔记。</small>
      </section>
    );
  }

  return (
    <section
      ref={scroller}
      className="thinking-desk"
      aria-label="思路桌面"
      onScroll={(event) => {
        rememberScroll(query, event.currentTarget.scrollTop);
      }}
    >
      {!terms.length && (
        <section className="desk-start" aria-label="推荐下一步">
          <div className="desk-start-heading">
            <span className="desk-eyebrow">
              {entry
                ? '不妨从这里开始'
                : hasOpenBranch
                  ? '给这些事情找一个起点'
                  : '留一点空白，也很好'}
            </span>
            <span className="desk-start-symbol" aria-hidden="true">
              ↗
            </span>
          </div>
          {entry && entryNode ? (
            <>
              <button
                type="button"
                className="desk-entry-title"
                onClick={() => props.onFocus(entry.nodeId)}
              >
                {entryNode.title}
              </button>
              <p className="desk-entry-reason">{entry.reason}</p>
              <div className="desk-next-step">
                <span>下一步</span>
                <p>{entry.nextStep}</p>
              </div>
              <div className="desk-entry-actions">
                <button
                  type="button"
                  className="desk-primary"
                  onClick={() => {
                    props.onFocus(entry.nodeId);
                    props.onCompose(`关于“${entryNode.title}”：${entry.nextStep}\n我的想法是：`);
                  }}
                >
                  我来想一想 ↙
                </button>
                <button
                  type="button"
                  className="desk-quiet"
                  disabled={props.busy}
                  onClick={() => {
                    props.onFocus(entry.nodeId);
                    props.onExplore(
                      `沿这个入口继续：${entry.nextStep}。给出有内容的推演和下一步，把关键联系放进导图。`,
                      entry.nodeId,
                    );
                  }}
                >
                  一起推演 ↗
                </button>
                {entries.length > 1 && (
                  <div className="desk-other-entries" aria-label="其他切入点">
                    {entries.map((item, index) => (
                      <button
                        type="button"
                        key={item.nodeId}
                        title={findMindMapNodeById(props.document, item.nodeId)?.title}
                        aria-pressed={item.nodeId === entry.nodeId}
                        aria-label={`切入点 ${index + 1}：${findMindMapNodeById(props.document, item.nodeId)?.title}`}
                        onClick={() =>
                          setEntryChoice({ navigation: props.navigation, nodeId: item.nodeId })
                        }
                      >
                        0{index + 1}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : hasOpenBranch ? (
            <>
              <h2>事情都在这里。先动哪一件？</h2>
              <p className="desk-entry-reason">找一件想清楚之后，能让其他事也顺起来的事。</p>
              <button
                type="button"
                className="desk-primary"
                disabled={props.busy}
                onClick={() => props.onExplore(THINKING_LENSES[0].prompt, null)}
              >
                帮我选个起点 ↗
              </button>
            </>
          ) : (
            <>
              <h2>眼前的事，先安放好了。</h2>
              <p className="desk-entry-reason">
                想继续时，可以把暂放的念头放回眼前，也可以开始一件新事。
              </p>
              <button
                type="button"
                className="desk-primary"
                onClick={() => {
                  props.onFocus(null);
                  props.onCompose('');
                }}
              >
                写个新念头 ↙
              </button>
            </>
          )}
        </section>
      )}

      <div className="desk-section-heading">
        <div>
          <h2>{terms.length ? '找到的念头' : '摊开来看看'}</h2>
          <span>
            {terms.length
              ? `${results.length} 个匹配`
              : `${branches.length} 组思路 · 点开一个，继续往下想`}
          </span>
        </div>
        <div className="desk-search">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="找一个念头"
            placeholder="找一个念头…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setQuery('');
            }}
          />
          {query && (
            <button type="button" aria-label="清空查找" onClick={() => setQuery('')}>
              ×
            </button>
          )}
        </div>
      </div>
      {terms.length ? (
        <div className="desk-search-results">
          {results.map((node) => (
            <ThoughtButton
              key={node.id}
              node={node}
              selected={node.id === props.selectedNodeId}
              onFocus={props.onFocus}
            />
          ))}
          {!results.length && (
            <div className="desk-no-results">
              <p>这里还没找到“{query.trim()}”。</p>
              <button
                type="button"
                className="desk-quiet"
                onClick={() => props.onCompose(query.trim())}
              >
                把它记下来 ↙
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="desk-branches">
          {branches.map((branch, index) => (
            <article className={`desk-branch status-${branch.status}`} key={branch.id}>
              <div className="desk-branch-heading">
                <span>{String(index + 1).padStart(2, '0')}</span>
                <ThoughtButton
                  node={branch}
                  selected={branch.id === props.selectedNodeId}
                  onFocus={props.onFocus}
                />
              </div>
              {branch.children.length > 0 && (
                <ul className="desk-branch-thoughts">
                  {branch.children.map((node) => (
                    <ThoughtBranch
                      key={node.id}
                      node={node}
                      selectedNodeId={props.selectedNodeId}
                      onFocus={props.onFocus}
                    />
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
