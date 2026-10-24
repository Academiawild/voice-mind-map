import { useLayoutEffect, useRef, useState } from 'react';
import {
  countMindMapNodes,
  findMindMapNodeById,
  type MindMapNode,
  type MindMapNodePatch,
} from '../../../shared/mind-map';
import type { WorkspaceState } from '../workspace/model';
import { activeThinkingEntries } from './thinking-tools';

type ActivityPanelProps = {
  state: WorkspaceState;
  showEntries?: boolean;
  onUpdateNode: (nodeId: string, patch: MindMapNodePatch) => void;
  onSetNodeStatus: (nodeId: string, status: MindMapNode['status']) => void;
  onDeleteNode: (nodeId: string) => void;
  onExpand: (nodeId: string, title: string) => void;
  onToggleInference: (nodeId: string) => void;
  onUndo: () => void;
  onResumeCapture: (id: string, transcript: string) => void;
  onFocus: (nodeId: string | null) => void;
  onExplore: (input: string, nodeId: string | null) => void;
  onCompose: (text: string) => void;
};

const sourceLabels = { user: '你的表达', summary: '整理归纳', inference: 'AI 联想' };

function NodeEditor({ node, props }: { node: MindMapNode; props: ActivityPanelProps }) {
  const [title, setTitle] = useState(node.title);
  const [content, setContent] = useState(node.content);
  return (
    <details className="navigation-details">
      <summary>编辑这个念头</summary>
      <label>
        标题
        <input value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        补充说明
        <textarea rows={5} value={content} onChange={(event) => setContent(event.target.value)} />
      </label>
      <button
        type="button"
        disabled={!title.trim()}
        onClick={() => props.onUpdateNode(node.id, { title: title.trim(), content })}
      >
        保存修改
      </button>
      {node.id !== props.state.document?.root.id && (
        <button
          type="button"
          className="activity-danger"
          onClick={() => props.onDeleteNode(node.id)}
        >
          删除整个分支
        </button>
      )}
    </details>
  );
}

export function ActivityPanel(props: ActivityPanelProps) {
  const { state } = props;
  const selected = findMindMapNodeById(state.document, state.selection.nodeId);
  const panel = useRef<HTMLElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const readingKey = `${props.showEntries === false ? 'desk' : 'map'}:${selected?.id ?? 'all'}`;
  useLayoutEffect(() => {
    if (panel.current) panel.current.scrollTop = scrollPositions.current.get(readingKey) ?? 0;
  }, [readingKey]);
  const entries = activeThinkingEntries(state.document, state.navigation);
  const relations = (state.document?.relations ?? []).filter(
    (relation) =>
      !selected || relation.sourceId === selected.id || relation.targetId === selected.id,
  );
  const activity = state.activity;
  const busy =
    state.request.inFlight || !['idle', 'completed', 'failed'].includes(state.captureSession.phase);
  return (
    <aside
      ref={panel}
      className="activity-panel"
      aria-label="思考导航"
      onScroll={(event) => scrollPositions.current.set(readingKey, event.currentTarget.scrollTop)}
    >
      <header>
        <span className="activity-eyebrow">{selected ? '顺着这个念头' : '事情之间的联系'}</span>
        <span className="navigation-dot">{busy ? '思考中' : '思考导航'}</span>
      </header>
      {selected ? (
        <section className="navigation-focus">
          <button type="button" className="navigation-back" onClick={() => props.onFocus(null)}>
            ← 回到全图
          </button>
          <span className={`source-pill source-${selected.source}`}>
            {sourceLabels[selected.source]}
          </span>
          <h2>{selected.title}</h2>
          {selected.content && <p className="navigation-content">{selected.content}</p>}
          <div className="navigation-actions">
            <button
              type="button"
              className="activity-primary"
              disabled={busy || !state.serviceStatus?.ai.ready}
              onClick={() => props.onExpand(selected.id, selected.title)}
            >
              沿这里继续 ↗
            </button>
            <button
              type="button"
              onClick={() => props.onCompose(`关于“${selected.title}”，我的意思是：`)}
            >
              纠正理解
            </button>
          </div>
          <div className="thought-status-actions" aria-label="这个念头的状态">
            <button
              type="button"
              aria-pressed={selected.status === 'done'}
              onClick={() =>
                props.onSetNodeStatus(selected.id, selected.status === 'done' ? 'open' : 'done')
              }
            >
              {selected.status === 'done'
                ? '✓ 已理清 · 重新打开'
                : selected.kind === 'task'
                  ? '✓ 做完了'
                  : '✓ 想清楚了'}
            </button>
            <button
              type="button"
              aria-pressed={selected.status === 'later'}
              onClick={() =>
                props.onSetNodeStatus(selected.id, selected.status === 'later' ? 'open' : 'later')
              }
            >
              {selected.status === 'later' ? '↩ 放回眼前' : '先放一放'}
            </button>
          </div>
          {selected.children.some((child) => child.source === 'inference') && (
            <button
              className="navigation-back"
              type="button"
              onClick={() => props.onToggleInference(selected.id)}
            >
              {state.expandedInferenceNodeIds.includes(selected.id)
                ? '收起 AI 联想'
                : '展开 AI 联想'}
            </button>
          )}
          <NodeEditor
            key={`${selected.id}:${selected.title}:${selected.content}`}
            node={selected}
            props={props}
          />
        </section>
      ) : (
        <section className="navigation-intro">
          <h2>{state.document ? '原来，它们互相牵动。' : '不用一开始就有条理。'}</h2>
          <p>
            {state.document
              ? '点开一个念头，看看它连接着什么。'
              : '先说出来。分类、联系、先后顺序，我们一起慢慢理。'}
          </p>
        </section>
      )}

      {state.document && props.showEntries !== false && (
        <section className="navigation-section">
          <div className="navigation-section-heading">
            <h3>可以从这里开始</h3>
            <span>选一个，继续</span>
          </div>
          {entries.length ? (
            entries.map((entry, index) => {
              const node = findMindMapNodeById(state.document, entry.nodeId)!;
              return (
                <article className="thinking-entry" key={entry.nodeId}>
                  <button
                    className="thinking-entry-title"
                    type="button"
                    onClick={() => props.onFocus(entry.nodeId)}
                  >
                    <span className="entry-number">0{index + 1}</span>
                    <strong>{node.title}</strong>
                    <span>↗</span>
                  </button>
                  <p>{entry.reason}</p>
                  <div className="entry-next">
                    <span>下一步</span>
                    <p>{entry.nextStep}</p>
                  </div>
                  <button
                    className="navigation-link"
                    type="button"
                    disabled={busy || !state.serviceStatus?.ai.ready}
                    onClick={() => {
                      props.onFocus(entry.nodeId);
                      props.onExplore(
                        `沿这个入口继续：${entry.nextStep}。分析具体联系、可检验的前提，并给出下一步。不要假定用户已同意建议。`,
                        entry.nodeId,
                      );
                    }}
                  >
                    沿这里继续 →
                  </button>
                </article>
              );
            })
          ) : (
            <p className="navigation-placeholder">点一下“排个先后”，找出最值得先动的一件事。</p>
          )}
          <button
            type="button"
            className="navigation-secondary"
            disabled={busy || !state.serviceStatus?.ai.ready}
            onClick={() =>
              props.onExplore(
                entries.length
                  ? `换一个切入点。上次建议是 ${entries.map((entry) => entry.nodeId).join('、')}。寻找不同但有依据的联系，重新给出 navigation；不必为此新增节点。`
                  : '请分析当前全部念头的跨分支联系，补充有解释的 relations，并给出有理由、有具体下一步的 navigation。直接建议一个值得先动的方向，解释你的取舍。',
                null,
              )
            }
          >
            {entries.length ? '↻ 换个切入点' : '寻找联系与入口 ↗'}
          </button>
        </section>
      )}

      {state.document && (
        <section className="navigation-section">
          <div className="navigation-section-heading">
            <h3>{selected ? '与这个念头的联系' : '联系线索'}</h3>
            <span>{relations.length} 条</span>
          </div>
          {relations.length ? (
            relations.map((relation) => {
              const from = findMindMapNodeById(state.document, relation.sourceId);
              const to = findMindMapNodeById(state.document, relation.targetId);
              if (!from || !to) return null;
              return (
                <article
                  className={`connection-card ${relation.dashed ? 'is-tentative' : ''}`}
                  key={relation.id}
                >
                  <div className="connection-endpoints">
                    <button type="button" onClick={() => props.onFocus(from.id)}>
                      {from.title}
                    </button>
                    <span>→</span>
                    <button type="button" onClick={() => props.onFocus(to.id)}>
                      {to.title}
                    </button>
                  </div>
                  <p>
                    {relation.dashed && <span className="connection-tag">联想</span>}
                    {relation.label || '这条联系尚未说明理由'}
                  </p>
                  <button
                    type="button"
                    className="navigation-link"
                    onClick={() =>
                      props.onCompose(
                        `请纠正联系 ${relation.id}（“${from.title}” → “${to.title}”）：`,
                      )
                    }
                  >
                    这条联系不对
                  </button>
                </article>
              );
            })
          ) : (
            <p className="navigation-placeholder">
              还没有画出的联系。试试“大胆联想”，看看这些事之间藏着什么。
            </p>
          )}
        </section>
      )}

      {activity && (
        <details className="navigation-details">
          <summary>
            本次变更
            {activity.counts.replaced
              ? ` · 创建 ${countMindMapNodes(state.document)} 个节点`
              : ` · ${activity.counts.added} 新增 · ${activity.counts.updated} 修改`}
          </summary>
          <p>{activity.summary}</p>
          {activity.rejectedCommands.length > 0 && (
            <p>有 {activity.rejectedCommands.length} 处变更未应用，原内容保留。</p>
          )}
          <button type="button" disabled={!state.history.past.length} onClick={props.onUndo}>
            撤销本次变更
          </button>
        </details>
      )}
      {state.savedInputs.length > 0 && (
        <details className="navigation-details">
          <summary>原始输入 · {state.savedInputs.length}</summary>
          <p>最初是怎么想的，都留在这里。</p>
          {[...state.savedInputs].reverse().map((input) => (
            <article className="saved-input" key={input.id}>
              <time>{new Date(input.createdAt).toLocaleString('zh-CN')}</time>
              <p>{input.text}</p>
              <button type="button" onClick={() => props.onCompose(input.text)}>
                带回输入框 ↙
              </button>
            </article>
          ))}
        </details>
      )}
      {state.pendingCaptures.length > 0 && (
        <section className="pending-captures">
          <h3>待整理录音</h3>
          {state.pendingCaptures.map((capture) =>
            capture.status === 'recognized' ? (
              <button
                type="button"
                disabled={busy || !state.serviceStatus?.ai.ready}
                key={capture.id}
                onClick={() => props.onResumeCapture(capture.id, capture.transcript)}
              >
                <span>{capture.transcript}</span>
                <small>继续整理</small>
              </button>
            ) : null,
          )}
        </section>
      )}
    </aside>
  );
}
