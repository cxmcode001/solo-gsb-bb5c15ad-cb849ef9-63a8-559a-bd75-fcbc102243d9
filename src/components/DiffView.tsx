import { useEffect, useRef } from 'react';
import type { Analysis, Sample } from '../types';
import { buildOriginalPieces, buildResultPieces } from '../lib/highlight';
import { PieceView } from './PieceView';

interface DiffViewProps {
  analysis: Analysis;
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

export function DiffView(props: DiffViewProps) {
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

  const text = sample.text;
  const origPieces = buildOriginalPieces(text, analysis.hits, analysis.coverage);
  const resultPieces = buildResultPieces(text, analysis.segments, analysis.hits, analysis.coverage);
  const hitById = new Map(analysis.hits.map((h) => [h.id, h]));

  const viewProps = {
    hitById,
    activeKey,
    hoveredKey,
    onSelect,
    onHover,
  };

  // 选中某条命中 / 未覆盖项时，联动滚动两栏到对应位置
  useEffect(() => {
    if (!activeKey || focusNonce === 0) return;
    const scrollToMark = (container: HTMLElement | null) => {
      const sel = `mark[data-hit="${CSS.escape(activeKey)}"], mark[data-cov="${CSS.escape(activeKey)}"]`;
      container?.querySelector(sel)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    };
    scrollToMark(origRef.current);
    scrollToMark(resultRef.current);
  }, [activeKey, focusNonce]);

  return (
    <div className="diff-grid">
      <div className="diff-pane">
        <div className="diff-pane-head">
          <span>📄 原文</span>
          <span className="spacer" />
          {!editing ? (
            <button className="btn" onClick={() => onDraftText(text)}>
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
            />
          </div>
        ) : (
          <div className="diff-scroll">
            <pre className="diff-text" ref={origRef}>
              <PieceView pieces={origPieces} {...viewProps} />
            </pre>
          </div>
        )}
      </div>

      <div className="diff-pane">
        <div className="diff-pane-head">
          <span>🛡️ 脱敏结果（一次性替换，生成物不再参与匹配）</span>
          <span className="spacer" />
          <span className="stat-line">
            采用 <b className="ok">{analysis.stats.adopted}</b> · 舍弃{' '}
            <b className="skip">{analysis.stats.rejected}</b>
          </span>
        </div>
        <div className="diff-scroll">
          <pre className="diff-text" ref={resultRef}>
            <PieceView pieces={resultPieces} {...viewProps} />
          </pre>
        </div>
      </div>
    </div>
  );
}
