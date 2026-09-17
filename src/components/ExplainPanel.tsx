import type { Analysis, Rule } from '../types';
import { posToLineCol } from '../lib/highlight';

interface ExplainPanelProps {
  analysis: Analysis;
  rules: Rule[];
  text: string;
  activeKey: string | null;
  onSelect: (key: string) => void;
  onHover: (key: string | null) => void;
}

const KIND_LABEL: Record<string, string> = {
  all: '全文',
  line: '逐行',
};

export function ExplainPanel({
  analysis,
  rules,
  text,
  activeKey,
  onSelect,
  onHover,
}: ExplainPanelProps) {
  if (analysis.hits.length === 0 && analysis.errors.length === 0) {
    return <div className="empty">当前规则在样本文本上没有任何命中。</div>;
  }

  const enabledRules = rules.filter((r) => r.enabled);

  return (
    <div>
      <div className="stat-line" style={{ marginBottom: 10 }}>
        <span>
          共 <b>{analysis.stats.total}</b> 次命中：
        </span>
        <span>
          <b className="ok">{analysis.stats.adopted}</b> 采用
        </span>
        <span>
          <b className="skip">{analysis.stats.rejected}</b> 舍弃
        </span>
        <span>裁决顺序：规则优先级（列表序号）→ 起始位置</span>
      </div>

      {enabledRules.map((rule) => {
        const priority = rules.indexOf(rule) + 1;
        const ruleHits = analysis.hits.filter((h) => h.ruleId === rule.id);
        const adopted = ruleHits.filter((h) => h.adopted).length;
        const rejected = ruleHits.length - adopted;
        const err = analysis.errors.find((e) => e.ruleId === rule.id);

        return (
          <div className="explain-group" key={rule.id}>
            <div className="explain-group-head">
              <span className="color-dot" style={{ background: rule.color }} />
              <span>
                #{priority} {rule.name}
              </span>
              <span className="hint">
                {KIND_LABEL[rule.scope]} · {ruleHits.length > 0 && (
                  <>
                    <b style={{ color: 'var(--ok)' }}>{adopted}</b> 采用
                    {rejected > 0 && (
                      <>
                        {' '}
                        · <span style={{ color: 'var(--warning)' }}>{rejected}</span> 舍弃
                      </>
                    )}
                  </>
                )}
                {ruleHits.length === 0 && !err && '无命中'}
              </span>
            </div>

            {err && <div className="rule-error" style={{ padding: '0 4px 6px' }}>正则无效，已跳过：{err.message}</div>}

            {ruleHits.map((h) => {
              const { line, col } = posToLineCol(text, h.start);
              return (
                <div
                  key={h.id}
                  className={`hit-item ${h.adopted ? '' : 'rejected'} ${activeKey === h.id ? 'active' : ''}`}
                  style={{ borderLeftColor: rule.color }}
                  onClick={() => onSelect(h.id)}
                  onMouseEnter={() => onHover(h.id)}
                  onMouseLeave={() => onHover(null)}
                >
                  <div className="hit-title">
                    {h.adopted ? <span className="tag ok">采用</span> : <span className="tag skip">舍弃</span>}
                    <code>{h.text === '' ? '（零宽匹配）' : h.text}</code>
                  </div>
                  <div className="hit-meta">
                    位置 [{h.start}, {h.end}) · 第 {line} 行第 {col} 列
                    {h.groups.length > 0 && (
                      <>
                        {' '}
                        · 捕获：
                        {h.groups.map((g, gi) => (
                          <code key={gi} style={{ marginLeft: 4 }}>
                            ${gi + 1}={g === '' ? '∅' : g}
                          </code>
                        ))}
                      </>
                    )}
                  </div>
                  {h.adopted ? (
                    <div className="hit-replace">
                      替换为 <code>{h.replacement}</code>
                    </div>
                  ) : (
                    <div className="hit-reason">✕ {h.rejectedReason}</div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
      {analysis.errors.map((err) => {
        const rule = rules.find((r) => r.id === err.ruleId);
        if (rule && rule.enabled) return null;
        return (
          <div className="rule-error" key={err.ruleId}>
            {rule?.name}: {err.message}
          </div>
        );
      })}
    </div>
  );
}
