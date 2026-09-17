import { useEffect, useRef } from 'react';
import type { Analysis, JsonAnalysis, Sample, SampleMode } from '../types';
import { buildOriginalPieces, buildResultPieces } from '../lib/highlight';
import { PieceView } from './PieceView';
import { JsonTreeView } from './JsonTreeView';

interface DiffViewProps {
  mode: SampleMode;
  analysis: Analysis;
  json: JsonAnalysis | null;
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
    mode,
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

  // mode === 'json' 时 App 保证 jsonAnalysis 已计算完成
  const json = props.json;

  const hitById = new Map(
    (mode === 'json' && json ? json.hits : analysis.hits).map((h) => [h.id, h]),
  );

  const viewProps = {
    hitById,
    activeKey,
    hoveredKey,
    onSelect,
    onHover,
  };

  const origPieces = buildOriginalPieces(text, analysis.hits, analysis.coverage);
  const resultPieces = buildResultPieces(
    text,
    analysis.segments,
    analysis.hits,
    analysis.coverage,
  );

  const stats = mode === 'json' && json ? json.stats : analysis.stats;
  const parseError = mode === 'json' ? json?.parseError ?? null : null;
  // 非解析失败的 JSON 分支里使用：此时 json 必然存在
  const jsonView = mode === 'json' && json && !json.parseError ? json : null;

  // 选中某条命中 / 未覆盖项时，联动滚动两栏到对应位置
  useEffect(() => {
    if (!activeKey || focusNonce === 0) return;
    const scrollToMark = (container: HTMLElement | null) => {
      const sel = `mark[data-hit="${CSS.escape(activeKey)}"], mark[data-cov="${CSS.escape(activeKey)}"]`;
      container?.querySelector(sel)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
    scrollToMark(origRef.current);
    scrollToMark(resultRef.current);
  }, [activeKey, focusNonce]);

  return (
    <div className="diff-grid">
      <div className="diff-pane">
        <div className="diff-pane-head">
          <span>📄 原文{mode === 'json' ? '（JSON 结构化：键名/数字/布尔/null 原样保留）' : ''}</span>
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
        ) : parseError ? (
          <div className="diff-scroll" style={{ padding: 12 }}>
            <pre className="mono json-error-source">{text}</pre>
          </div>
        ) : (
          <div className="diff-scroll">
            <pre className="diff-text" ref={origRef}>
              {jsonView ? (
                <JsonTreeView
                  variant="original"
                  tree={jsonView.data}
                  fields={jsonView.fields}
                  {...viewProps}
                />
              ) : (
                <PieceView pieces={origPieces} {...viewProps} />
              )}
            </pre>
          </div>
        )}
      </div>

      <div className="diff-pane">
        <div className="diff-pane-head">
          <span>
            🛡️ 脱敏结果
            {mode === 'json'
              ? '（仅字符串值参与匹配，禁止跨字段）'
              : '（一次性替换，生成物不再参与匹配）'}
          </span>
          <span className="spacer" />
          <span className="stat-line">
            采用 <b className="ok">{stats.adopted}</b> · 舍弃{' '}
            <b className="skip">{stats.rejected}</b>
          </span>
        </div>
        {parseError ? (
          <div className="diff-scroll" style={{ padding: 12 }}>
            <div className="json-parse-error">
              <div className="json-parse-error-title">❌ JSON 解析失败，未生成脱敏结果</div>
              <div className="json-parse-error-pos">
                第 <b>{parseError.line}</b> 行第 <b>{parseError.col}</b> 列
                （字符偏移 {parseError.pos}）
              </div>
              <pre className="json-parse-error-msg">{parseError.message}</pre>
            </div>
          </div>
        ) : (
          <div className="diff-scroll">
            <pre className="diff-text" ref={resultRef}>
              {jsonView ? (
                <JsonTreeView
                  variant="masked"
                  tree={jsonView.masked}
                  fields={jsonView.fields}
                  {...viewProps}
                />
              ) : (
                <PieceView pieces={resultPieces} {...viewProps} />
              )}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
