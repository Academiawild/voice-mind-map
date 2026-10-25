import { useEffect, useState } from 'react';
import { countMindMapNodes } from '../../../shared/mind-map';
import type { WorkspaceState } from './model';

export function WorkspaceHeader(props: {
  state: WorkspaceState;
  onUndo: () => void;
  onRedo: () => void;
  onFit: () => void;
  onExportJson: () => void;
  onExportMarkdown: () => void;
  onShutdown: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, []);
  const status = props.state.serviceStatus;
  const ready = Boolean(status?.ai.ready);
  const speechReady = status?.transcription.http.ready || status?.transcription.realtime.ready;
  return (
    <header className="workspace-header">
      <div className="workspace-title">
        <h1>{props.state.document?.title ?? '思考整理台'}</h1>
        <span>{countMindMapNodes(props.state.document)} 个节点</span>
        <span className="header-relation-count">
          {props.state.document?.relations.length ?? 0} 条联系
        </span>
      </div>
      <div className="workspace-header-actions">
        <button
          type="button"
          onClick={props.onUndo}
          disabled={!props.state.history.past.length}
          aria-label="撤销"
        >
          ↶
        </button>
        <button
          type="button"
          onClick={props.onRedo}
          disabled={!props.state.history.future.length}
          aria-label="重做"
        >
          ↷
        </button>
        <button type="button" onClick={props.onFit}>
          显示全图
        </button>
        <div
          className={`service-indicator ${ready ? 'is-ready' : 'is-offline'}`}
          title={
            status
              ? `${status.ai.provider === 'api' ? '在线 AI' : '本地 AI'}: ${status.ai.model}\nHTTP ASR: ${status.transcription.http.model}\n实时 ASR: ${status.transcription.realtime.model}`
              : '本地服务离线'
          }
        >
          <i />
          <span>
            {!status
              ? '服务离线'
              : !status?.ai.ready
                ? 'AI 模型未就绪'
                : speechReady
                  ? '服务正常'
                  : '语音加载中'}
          </span>
        </div>
        <div className="workspace-menu-shell">
          <button
            type="button"
            className="workspace-more"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => setMenuOpen((current) => !current)}
          >
            更多
          </button>
          {menuOpen ? (
            <div className="workspace-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={props.onExportJson}
                disabled={!props.state.document}
              >
                导出 JSON
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={props.onExportMarkdown}
                disabled={!props.state.document}
              >
                导出 Markdown
              </button>
              <hr />
              <button
                type="button"
                role="menuitem"
                className="menu-danger"
                onClick={props.onShutdown}
              >
                关闭本次运行
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
