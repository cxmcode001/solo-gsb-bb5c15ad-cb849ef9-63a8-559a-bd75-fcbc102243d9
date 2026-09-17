import type { Analysis, Hit, JsonAnalysis, Rule, SampleMode } from '../types';
import { posToLineCol } from '../lib/highlight';

interface ExplainPanelProps {
  mode: SampleMode;
  analysis: Analysis;
  json: JsonAnalysis | null;
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

function HitItem({
  h,
  fieldText,
  activeKey,
  onSelect,
  onHover,
}: {
  h: Hit;
  /** 命中坐标所在文本（纯文本=全文；JSON=该字段值） */
  fieldText: string;
  activeKey: string | null;
  onSelect: (key: string) => void;
  onHover: (key: string | null) => void;
}) {
  const { line, col } = posToLineCol(fieldText, h.start);
  return (
    <div
      className={`hit-item ${h.adopted ? '' : 'rejected'} ${activeKey === h.id ? 'active' : ''}`}
      style={{ borderLeftColor: h.color }}
      onClick={() => onSelect(h.id)}
      onMouseEnter={() => onHover(h.id)}
      onMouseLeave={() => onHover(null)}
    >
      <div className="hit-title">
        {h.adopted ? <span className="tag ok">采用</span> : <span className="tag skip">舍弃</span>}
        <code>{h.text === '' ? '（零宽匹配）' : h.text}</code>
      </div>
      <div className="hit-meta">
        规则 #{h.priority} {h.ruleName} · 字段内位置 [{h.start}, {h.end}) · 第 {line} 行第 {col}{' '}
        列
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
}

function TextModeExplanation({
  analysis,
  rules,
  text,
  activeKey,
  onSelect,
  onHover,
}: Omit<ExplainPanelProps, 'mode' | 'json'>) {
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

            {err && (
              <div className="rule-error" style={{ padding: '0 4px 6px' }}>
                正则无效，已跳过：{err.message}
              </div>
            )}

            {ruleHits.map((h) => (
              <HitItem
                key={h.id}
                h={h}
                fieldText={text}
                activeKey={activeKey}
                onSelect={onSelect}
                onHover={onHover}
              />
            ))}
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

function JsonModeExplanation({
  json,
  activeKey,
  onSelect,
  onHover,
}: {
  json: JsonAnalysis;
  activeKey: string | null;
  onSelect: (key: string) => void;
  onHover: (key: string | null) => void;
}) {
  if (json.parseError) {
    return (
      <div className="json-parse-error">
        <div className="json-parse-error-title">❌ JSON 解析失败，未生成脱敏结果</div>
        <div className="json-parse-error-pos">
          第 <b>{json.parseError.line}</b> 行第 <b>{json.parseError.col}</b> 列（字符偏移{' '}
          {json.parseError.pos}）
        </div>
        <pre className="json-parse-error-msg">{json.parseError.message}</pre>
      </div>
    );
  }

  if (json.hits.length === 0 && json.fields.length > 0 && json.errors.length === 0) {
    return <div className="empty">当前规则在任何字符串字段上都没有命中。</div>;
  }

  return (
    <div>
      <div className="stat-line" style={{ marginBottom: 10 }}>
        <span>
          共扫描 <b>{json.fields.length}</b> 个字符串字段
        </span>
        <span>
          <b>{json.stats.total}</b> 次命中：
        </span>
        <span>
          <b className="ok">{json.stats.adopted}</b> 采用
        </span>
        <span>
          <b className="skip">{json.stats.rejected}</b> 舍弃
        </span>
        <span>字段间互不可见，单字段内沿用规则优先级与重叠裁决</span>
      </div>

      {json.fields
        .filter((f) => f.analysis.hits.length > 0)
        .map((field) => (
          <div className="explain-group" key={field.pointer}>
            <div className="explain-group-head json-pointer-head">
              <span className="json-pointer-tag" title="RFC 6901 JSON Pointer">
                {field.pointer === '' ? '（顶层字符串）' : field.pointer}
              </span>
              <span className="hint">
                {field.analysis.stats.total} 次命中 · {field.analysis.stats.adopted} 采用
                {field.analysis.stats.rejected > 0 && (
                  <>
                    {' '}
                    · <span style={{ color: 'var(--warning)' }}>
                      {field.analysis.stats.rejected}
                    </span>{' '}
                    舍弃
                  </>
                )}
              </span>
            </div>
            {field.analysis.hits.map((h) => (
              <HitItem
                key={h.id}
                h={h}
                fieldText={field.value}
                activeKey={activeKey}
                onSelect={onSelect}
                onHover={onHover}
              />
            ))}
          </div>
        ))}

      {json.errors.length > 0 && (
        <div className="explain-group">
          <div className="explain-group-head">
            <span>无效规则（已跳过，未扫描任何字段）</span>
          </div>
          {json.errors.map((err) => (
            <div className="rule-error" key={err.ruleId} style={{ padding: '0 4px 6px' }}>
              {err.message}
            </div>
          ))}
        </div>
      )}

      {json.fields.length === 0 && (
        <div className="empty">JSON 中没有对象或数组承载的字符串值（仅数字/布尔/null/键名），无需脱敏。</div>
      )}
    </div>
  );
}

export function ExplainPanel(props: ExplainPanelProps) {
  const { mode, json, analysis, rules, text, activeKey, onSelect, onHover } = props;
  if (mode === 'json' && json) {
    return (
      <JsonModeExplanation
        json={json}
        activeKey={activeKey}
        onSelect={onSelect}
        onHover={onHover}
      />
    );
  }
  return (
    <TextModeExplanation
      analysis={analysis}
      rules={rules}
      text={text}
      activeKey={activeKey}
      onSelect={onSelect}
      onHover={onHover}
    />
  );
}
