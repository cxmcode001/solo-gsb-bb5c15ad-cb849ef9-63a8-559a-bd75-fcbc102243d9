import type { Analysis, Rule, RuleScope } from '../types';
import { normalizeFlags } from '../lib/engine';

interface RulePanelProps {
  rules: Rule[];
  analysis: Analysis;
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<Rule>) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
}

function validate(rule: Rule): string | null {
  if (!rule.pattern) return '正则表达式不能为空';
  try {
    new RegExp(rule.pattern, normalizeFlags(rule.flags));
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export function RulePanel({ rules, analysis, onAdd, onUpdate, onDelete, onMove }: RulePanelProps) {
  return (
    <>
      <div className="panel-head">
        <h2>规则（有序）</h2>
        <span className="hint">越靠上优先级越高；全部规则先匹配原文，重叠时高优先级胜出</span>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={onAdd}>
          ＋ 新建规则
        </button>
      </div>
      <div className="panel-body">
        <div className="rule-list">
          {rules.length === 0 && <div className="empty">还没有规则，点击「新建规则」开始。</div>}
          {rules.map((rule, i) => {
            const err = validate(rule);
            const engineErr = analysis.errors.find((e) => e.ruleId === rule.id);
            const ruleHits = analysis.hits.filter((h) => h.ruleId === rule.id);
            const adopted = ruleHits.filter((h) => h.adopted).length;
            const rejected = ruleHits.length - adopted;

            return (
              <div className={`rule-card ${err || engineErr ? 'invalid' : ''}`} key={rule.id}>
                <div className="rule-card-head">
                  <span className="priority" title="优先级序号">
                    #{i + 1}
                  </span>
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={(e) => onUpdate(rule.id, { enabled: e.target.checked })}
                    title={rule.enabled ? '禁用规则' : '启用规则'}
                  />
                  <span className="color-dot" style={{ background: rule.color }} />
                  <div className="rule-name">
                    <input
                      type="text"
                      value={rule.name}
                      placeholder="规则名称"
                      onChange={(e) => onUpdate(rule.id, { name: e.target.value })}
                    />
                  </div>
                  <button
                    className="btn-ghost btn"
                    title="上移（提高优先级）"
                    disabled={i === 0}
                    onClick={() => onMove(rule.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    className="btn-ghost btn"
                    title="下移（降低优先级）"
                    disabled={i === rules.length - 1}
                    onClick={() => onMove(rule.id, 1)}
                  >
                    ↓
                  </button>
                  <button
                    className="btn-ghost btn btn-danger"
                    title="删除规则"
                    onClick={() => {
                      if (confirm(`删除规则「${rule.name}」？`)) onDelete(rule.id);
                    }}
                  >
                    ✕
                  </button>
                </div>

                <div className="rule-card-body">
                  <label>
                    正则表达式（源文，不含 // ）
                    <input
                      type="text"
                      className="mono"
                      value={rule.pattern}
                      spellCheck={false}
                      placeholder='例如：(\d{3})\d{4}(\d{4})'
                      onChange={(e) => onUpdate(rule.id, { pattern: e.target.value })}
                    />
                  </label>

                  <div className="rule-row">
                    <label style={{ flex: '0 0 110px' }}>
                      标志（g 强制）
                      <input
                        type="text"
                        className="mono"
                        value={rule.flags}
                        spellCheck={false}
                        placeholder="g"
                        onChange={(e) => onUpdate(rule.id, { flags: e.target.value })}
                      />
                    </label>
                    <label>
                      作用范围
                      <select
                        value={rule.scope}
                        onChange={(e) => onUpdate(rule.id, { scope: e.target.value as RuleScope })}
                      >
                        <option value="all">全文匹配</option>
                        <option value="line">逐行匹配（^/$ 锚定单行）</option>
                      </select>
                    </label>
                    <label style={{ flex: '0 0 56px' }}>
                      颜色
                      <input
                        type="color"
                        value={rule.color}
                        onChange={(e) => onUpdate(rule.id, { color: e.target.value })}
                      />
                    </label>
                  </div>

                  <label>
                    替换模板（$1 捕获组、$&amp; 整段命中、$$ 字面 $）
                    <input
                      type="text"
                      className="mono"
                      value={rule.template}
                      spellCheck={false}
                      placeholder="$1****$2"
                      onChange={(e) => onUpdate(rule.id, { template: e.target.value })}
                    />
                  </label>

                  {(err || engineErr) && (
                    <div className="rule-error">正则无效：{engineErr?.message ?? err}</div>
                  )}
                  {rule.enabled && !err && (
                    <div className="rule-hitcount">
                      命中 {ruleHits.length} 次{ruleHits.length > 0 && (
                        <>
                          {' '}（<b>{adopted} 采用</b>
                          {rejected > 0 && (
                            <>
                              {' '}/ <span className="rej">{rejected} 舍弃</span>
                            </>
                          )}
                          ）
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
