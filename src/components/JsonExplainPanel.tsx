import type { JsonAnalysis, Rule } from '../types';
import { posToLineCol } from '../lib/highlight';

interface JsonExplainPanelProps {
  analysis: JsonAnalysis;
  rules: Rule[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  onHover: (key: string | null) => void;
}

const KIND_LABEL: Record<string, string> = {
  all: '全文',
  line: '逐行',
};

const rootLabel = (pointer: string) => (pointer === '' ? '（根字符串）' : pointer);

/**
 * JSON 模式命中解释：先按 RFC 6901 JSON Pointer 分组（字段），
 * 每个字段内再按规则分组；位置为“值内行/列 + 字段在原文中的行列”。
 */
export function JsonExplainPanel({
  analysis,
  rules,
  activeKey,
  onSelect,
  onHover,
}: JsonExplainPanelProps) {
  const enabledRules = rules.filter((r) => r.enabled);

  return (
    <div>
      <div className="stat-line" style={{ marginBottom: 10 }}>
        <span>
          共扫描 <b>{analysis.fields.length}</b> 个字符串值
        </span>
        <span>
          共 <b>{analysis.stats.total}</b> 次命中：
        </span>
        <span>
          <b className="ok">{analysis.stats.adopted}</b> 采用
        </span>
        <span>
          <b className="skip">{analysis.stats.rejected}</b> 舍弃
        </span>
        <span>键名 / 数字 / 布尔 / null 不参与匹配，禁止跨字段</span>
      </div>

      {analysis.fields.map((field) => {
        const hits = field.analysis.hits;
        if (hits.length === 0) return null;
        return (
          <div className="json-field-group" key={field.fid}>
            <div className="json-pointer-head" title={field.pointer}>
              <span className="json-pointer-icon">📍</span>
              <code className="json-pointer">{rootLabel(field.pointer)}</code>
              <span className="hint">
                原文第 {field.line} 行第 {field.col} 列
              </span>
            </div>

            {enabledRules.map((rule) => {
              const priority = rules.indexOf(rule) + 1;
              const ruleHits = hits.filter((h) => h.ruleId === rule.id);
              if (ruleHits.length === 0) return null;
              const adopted = ruleHits.filter((h) => h.adopted).length;
              const rejected = ruleHits.length - adopted;

              return (
                <div className="explain-group" key={rule.id}>
                  <div className="explain-group-head">
                    <span className="color-dot" style={{ background: rule.color }} />
                    <span>
                      #{priority} {rule.name}
                    </span>
                    <span className="hint">
                      {KIND_LABEL[rule.scope]} ·{' '}
                      <b style={{ color: 'var(--ok)' }}>{adopted}</b> 采用
                      {rejected > 0 && (
                        <>
                          {' '}· <span style={{ color: 'var(--warning)' }}>{rejected}</span> 舍弃
                        </>
                      )}
                    </span>
                  </div>

                  {ruleHits.map((h) => {
                    const { line, col } = posToLineCol(field.value, h.start);
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
                          {h.adopted ? (
                            <span className="tag ok">采用</span>
                          ) : (
                            <span className="tag skip">舍弃</span>
                          )}
                          <code>{h.text === '' ? '（零宽匹配）' : h.text}</code>
                        </div>
                        <div className="hit-meta">
                          值内位置 [{h.start}, {h.end}) · 值内第 {line} 行第 {col} 列
                          {h.groups.length > 0 && (
                            <>
                              {' '}· 捕获：
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
          </div>
        );
      })}

      {analysis.fields.every((f) => f.analysis.hits.length === 0) && analysis.errors.length === 0 && (
        <div className="empty">当前规则在任何字符串值上都没有命中。</div>
      )}

      {analysis.errors.length > 0 && (
        <div className="explain-group">
          <div className="explain-group-head">
            <span>规则错误</span>
          </div>
          {analysis.errors.map((err) => {
            const rule = rules.find((r) => r.id === err.ruleId);
            return (
              <div className="rule-error" key={`${err.ruleId}:${err.message}`}>
                {rule?.name ?? err.ruleId}：{err.message}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
