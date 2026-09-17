import { useEffect, useRef } from 'react';
import type { Hit, JsonAnalysis, Sample } from '../types';
import { JsonTreeView } from './JsonTreeView';

interface JsonDiffViewProps {
  analysis: JsonAnalysis;
  sample: Sample;
  editing: boolean;
  draftText: string;
  onDraftText: (v: string) => void;
  onCommitText: () => void;
  onCancelEdit: () => void;
  activeKey: string | null;
  hoveredKey: string | null;
  onSelect: (key: string) => void;
  onHover: (key: string | null) => void;
  focusNonce: number;
}

export function JsonDiffView(props: JsonDiffViewProps) {
  const {
    analysis,
    sample,
    editing,
    draftText,
    onDraftText,
    onCommitText,
    onCancelEdit,
    activeKey,
    hoveredKey,
    onSelect,
    onHover,
    focusNonce,
  } = props;

  const origRef = useRef<HTMLPreElement>(null);
  const resultRef = useRef<HTMLPreElement>(null);

  const hitById = new Map<string, Hit>();
  for (const f of analysis.fields) for (const h of f.analysis.hits) hitById.set(h.id, h);

  const viewProps = {
    hitById,
    coverage: analysis.coverage,
    activeKey,
    hoveredKey,
    onSelect,
    onHover,
  };

  // 选中某条命中 / 未覆盖项时，联动滚动两栏到对应位置
  useEffect(() => {
    if (!activeKey || focusNonce === 0 || analysis.parseError) return;
    const scrollToMark = (container: HTMLElement | null) => {
      const sel = `mark[data-hit="${CSS.escape(activeKey)}"], mark[data-cov="${CSS.escape(activeKey)}"]`;
      container?.querySelector(sel)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    };
    scrollToMark(origRef.current);
    scrollToMark(resultRef.current);
  }, [activeKey, focusNonce, analysis.parseError]);

  return (
    <div className="diff-grid">
      <div className="diff-pane">
        <div className="diff-pane-head">
          <span>📄 原文 JSON（仅字符串值参与匹配）</span>
          <span className="spacer" />
          {!editing ? (
            <button className="btn" onClick={() => onDraftText(sample.text)}>
              编辑原文
            </button>
          ) : (
            <>
              <button className="btn btn-primary" onClick={onCommitText}>
                保存并分析
              </button>
              <button className="btn" onClick={onCancelEdit}>
                取消
              </button>
            </>
          )}
        </div>
        {editing ? (
          <div className="diff-scroll" style={{ padding: 10 }}>
            <textarea
              className="mono sample-input"
              style={{ height: '100%', minHeight: 200 }}
              value={draftText}
              onChange={(e) => onDraftText(e.target.value)}
              autoFocus
              spellCheck={false}
            />
          </div>
        ) : analysis.parseError ? (
          <div className="diff-scroll" style={{ padding: 12 }}>
            <pre className="json-raw">{sample.text || '（空文本）'}</pre>
          </div>
        ) : (
          <div className="diff-scroll">
            <pre className="diff-text json-text" ref={origRef}>
              {analysis.tree && <JsonTreeView node={analysis.tree} variant="original" {...viewProps} />}
            </pre>
          </div>
        )}
      </div>

      <div className="diff-pane">
        <div className="diff-pane-head">
          <span>🛡️ 脱敏结果（格式化 JSON，逐值一次性替换）</span>
          <span className="spacer" />
          {!analysis.parseError && (
            <span className="stat-line">
              扫描 <b>{analysis.fields.length}</b> 值 · 采用 <b className="ok">{analysis.stats.adopted}</b>{' '}
              · 舍弃 <b className="skip">{analysis.stats.rejected}</b>
            </span>
          )}
        </div>
        {analysis.parseError ? (
          <div className="json-error-pane">
            <div className="json-error-card">
              <div className="json-error-title">⛔ JSON 解析失败，未生成脱敏结果</div>
              <div className="json-error-msg">{analysis.parseError.message}</div>
              <div className="json-error-pos">
                第 <b>{analysis.parseError.line}</b> 行，第 <b>{analysis.parseError.col}</b> 列
                （字符偏移 {analysis.parseError.pos}）
              </div>
              <div className="hint">请修正原文后重试；解析失败时不会对任何内容执行脱敏。</div>
            </div>
          </div>
        ) : (
          <div className="diff-scroll">
            <pre className="diff-text json-text" ref={resultRef}>
              {analysis.tree && <JsonTreeView node={analysis.tree} variant="result" {...viewProps} />}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
