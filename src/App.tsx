import { useEffect, useMemo, useRef, useState } from 'react';
import type { Hit, PersistState, Rule, RuleError, Sample, SampleMode, SampleAnalysis } from './types';
import { analyze, analyzeJson } from './lib/engine';
import {
  defaultState,
  exportJson,
  loadState,
  parseImport,
  saveState,
  uid,
} from './lib/storage';
import { RulePanel } from './components/RulePanel';
import { DiffView } from './components/DiffView';
import { JsonDiffView } from './components/JsonDiffView';
import { ExplainPanel } from './components/ExplainPanel';
import { JsonExplainPanel } from './components/JsonExplainPanel';
import { CoveragePanel } from './components/CoveragePanel';
import { JsonCoveragePanel } from './components/JsonCoveragePanel';

type Tab = 'diff' | 'explain' | 'coverage';

const RULE_COLORS = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0891b2'];

/** JSON 模式下跨字段汇总命中与错误（规则面板只看总数） */
function flattenJson(ja: ReturnType<typeof analyzeJson>): { hits: Hit[]; errors: RuleError[] } {
  const hits: Hit[] = [];
  for (const f of ja.fields) hits.push(...f.analysis.hits);
  return { hits, errors: ja.errors };
}

export default function App() {
  const [state, setState] = useState<PersistState>(() => loadState());
  const [tab, setTab] = useState<Tab>('diff');
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 规则与样例持久化到 localStorage
  useEffect(() => {
    saveState(state);
  }, [state]);

  const toastTimer = useRef<number | undefined>(undefined);
  const showToast = (msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  };

  const sample: Sample | undefined =
    state.samples.find((s) => s.id === state.currentSampleId) ?? state.samples[0];

  const text = sample?.text ?? '';
  const mode: SampleMode = sample?.mode ?? 'text';

  const analysis: SampleAnalysis = useMemo(() => {
    if (mode === 'json') return analyzeJson(text, state.rules);
    return { ...analyze(text, state.rules), mode: 'text' as const };
  }, [text, state.rules, mode]);

  const isJson = analysis.mode === 'json';
  const parseError = isJson ? analysis.parseError : null;

  const allHits: Hit[] = isJson ? flattenJson(analysis).hits : analysis.hits;
  const allErrors: RuleError[] = analysis.errors;
  const output = isJson ? analysis.output ?? '' : analysis.output;
  const { coverage: coverageItems, stats } = analysis;

  // 文本或规则变化后，原有选中项可能失效
  useEffect(() => {
    setActiveKey(null);
    setHoveredKey(null);
  }, [state.currentSampleId, text, state.rules, mode]);

  /* ------------------------------ 规则操作 ------------------------------ */

  const addRule = () => {
    const color = RULE_COLORS[state.rules.length % RULE_COLORS.length];
    const rule: Rule = {
      id: uid('rule'),
      name: `新规则 ${state.rules.length + 1}`,
      enabled: true,
      pattern: '',
      flags: 'g',
      template: '***',
      scope: 'all',
      color,
    };
    setState((s) => ({ ...s, rules: [...s.rules, rule] }));
  };

  const updateRule = (id: string, patch: Partial<Rule>) => {
    setState((s) => ({
      ...s,
      rules: s.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
  };

  const deleteRule = (id: string) => {
    setState((s) => ({ ...s, rules: s.rules.filter((r) => r.id !== id) }));
  };

  const moveRule = (id: string, dir: -1 | 1) => {
    setState((s) => {
      const idx = s.rules.findIndex((r) => r.id === id);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= s.rules.length) return s;
      const rules = [...s.rules];
      const [item] = rules.splice(idx, 1);
      rules.splice(target, 0, item);
      return { ...s, rules };
    });
  };

  /* ------------------------------ 样例操作 ------------------------------ */

  const selectSample = (id: string) => {
    setEditing(false);
    setState((s) => ({ ...s, currentSampleId: id }));
  };

  const addSample = () => {
    const s: Sample = {
      id: uid('sample'),
      name: `样例 ${state.samples.length + 1}`,
      text: '',
      mode: 'text',
    };
    setState((prev) => ({ ...prev, samples: [...prev.samples, s], currentSampleId: s.id }));
    setEditing(true);
    setDraftText('');
  };

  const setSampleMode = (next: SampleMode) => {
    if (!sample || sample.mode === next) return;
    setEditing(false);
    setState((s) => ({
      ...s,
      samples: s.samples.map((x) => (x.id === sample.id ? { ...x, mode: next } : x)),
    }));
  };

  const renameSample = () => {
    if (!sample) return;
    const name = prompt('样例名称', sample.name);
    if (name && name.trim()) {
      setState((s) => ({
        ...s,
        samples: s.samples.map((x) => (x.id === sample.id ? { ...x, name: name.trim() } : x)),
      }));
    }
  };

  const deleteSample = (id: string) => {
    setState((s) => {
      const samples = s.samples.filter((x) => x.id !== id);
      return {
        ...s,
        samples,
        currentSampleId: s.currentSampleId === id ? samples[0]?.id ?? null : s.currentSampleId,
      };
    });
  };

  const commitText = () => {
    if (!sample) return;
    setState((s) => ({
      ...s,
      samples: s.samples.map((x) => (x.id === sample.id ? { ...x, text: draftText } : x)),
    }));
    setEditing(false);
  };

  /* ------------------------------ 导入导出 ------------------------------ */

  const handleImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = parseImport(String(reader.result ?? ''));
      if ('error' in result) {
        alert(`导入失败：${result.error}`);
        return;
      }
      if (
        !confirm(
          `导入将替换当前全部 ${state.rules.length} 条规则和 ${state.samples.length} 个样例，是否继续？`,
        )
      ) {
        return;
      }
      setState(result);
      setEditing(false);
      setTab('diff');
      showToast('导入成功');
    };
    reader.readAsText(file);
  };

  const selectKey = (key: string) => {
    setActiveKey(key);
    setFocusNonce((n) => n + 1);
  };

  const copyOutput = async () => {
    if (parseError) {
      showToast('JSON 解析失败，没有可复制的脱敏结果');
      return;
    }
    try {
      await navigator.clipboard.writeText(output);
      showToast('脱敏结果已复制到剪贴板');
    } catch {
      showToast('复制失败，请手动选择文本复制');
    }
  };

  const resetAll = () => {
    if (!confirm('恢复内置演示规则与样例？当前本地配置将被覆盖。')) return;
    const fresh = defaultState();
    setState(fresh);
    setEditing(false);
    showToast('已恢复默认内容');
  };

  const uncoveredCount = coverageItems.length;

  const viewCommon = {
    sample: sample!,
    editing,
    draftText,
    onDraftText: (v: string) => {
      setDraftText(v);
      if (!editing) setEditing(true);
    },
    onCommitText: commitText,
    onCancelEdit: () => setEditing(false),
    activeKey,
    hoveredKey,
    onSelect: selectKey,
    onHover: setHoveredKey,
    focusNonce,
  };

  return (
    <>
      <header className="app-header">
        <h1>🔐 本地批量脱敏规则验证台</h1>
        <span className="spacer" />
        <div className="toolbar">
          <button className="btn" onClick={copyOutput} disabled={!!parseError}>
            复制脱敏结果
          </button>
          <button className="btn" onClick={() => exportJson(state)}>
            导出 JSON
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            导入 JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImportFile(f);
              e.target.value = '';
            }}
          />
          <button className="btn" onClick={resetAll}>
            恢复默认
          </button>
        </div>
      </header>

      <main className="app-main">
        {/* 左：规则配置 */}
        <section className="panel">
          <RulePanel
            rules={state.rules}
            hits={allHits}
            errors={allErrors}
            onAdd={addRule}
            onUpdate={updateRule}
            onDelete={deleteRule}
            onMove={moveRule}
          />
        </section>

        {/* 右：样例 + 结果 */}
        <section className="panel">
          <div className="panel-head">
            <div className="sample-bar">
              <select
                value={sample?.id ?? ''}
                onChange={(e) => selectSample(e.target.value)}
                title="选择样例"
              >
                {state.samples.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <div className="mode-switch" title="解析模式（随样例保存）">
                <button
                  className={mode === 'text' ? 'active' : ''}
                  onClick={() => setSampleMode('text')}
                >
                  纯文本
                </button>
                <button
                  className={mode === 'json' ? 'active' : ''}
                  onClick={() => setSampleMode('json')}
                >
                  JSON 结构化
                </button>
              </div>
              <button className="btn" onClick={renameSample} disabled={!sample}>
                重命名
              </button>
              <button className="btn" onClick={addSample}>
                ＋ 新样例
              </button>
              <button
                className="btn btn-danger"
                disabled={!sample || state.samples.length <= 1}
                onClick={() => {
                  if (sample && confirm(`删除样例「${sample.name}」？`)) deleteSample(sample.id);
                }}
              >
                删除样例
              </button>
            </div>
            <span className="spacer" />
            <div className="tabs">
              <button className={`tab ${tab === 'diff' ? 'active' : ''}`} onClick={() => setTab('diff')}>
                原文 / 结果对照
              </button>
              <button
                className={`tab ${tab === 'explain' ? 'active' : ''}`}
                onClick={() => setTab('explain')}
              >
                命中解释<span className="badge">{stats.total}</span>
              </button>
              <button
                className={`tab ${tab === 'coverage' ? 'active' : ''}`}
                onClick={() => setTab('coverage')}
              >
                未覆盖检查
                <span className={`badge ${uncoveredCount > 0 ? 'warn' : ''}`}>
                  {uncoveredCount}
                </span>
              </button>
            </div>
          </div>

          {parseError && (
            <div className="json-error-banner">
              ⛔ JSON 解析失败：{parseError.message}（第 {parseError.line} 行第 {parseError.col} 列），未生成脱敏结果
            </div>
          )}

          <div
            className="panel-body"
            style={{ padding: tab === 'diff' ? 12 : '12px 14px' }}
          >
            {!sample ? (
              <div className="empty">没有任何样例，请新建一个。</div>
            ) : tab === 'diff' ? (
              isJson ? (
                <JsonDiffView analysis={analysis} {...viewCommon} />
              ) : (
                <DiffView
                  analysis={analysis}
                  {...viewCommon}
                />
              )
            ) : tab === 'explain' ? (
              isJson ? (
                parseError ? (
                  <ParseErrorHint parseError={parseError} />
                ) : (
                  <JsonExplainPanel
                    analysis={analysis}
                    rules={state.rules}
                    activeKey={activeKey}
                    onSelect={(key) => {
                      selectKey(key);
                      setTab('diff');
                    }}
                    onHover={setHoveredKey}
                  />
                )
              ) : (
                <ExplainPanel
                  analysis={analysis}
                  rules={state.rules}
                  text={text}
                  activeKey={activeKey}
                  onSelect={(key) => {
                    selectKey(key);
                    setTab('diff');
                  }}
                  onHover={setHoveredKey}
                />
              )
            ) : parseError ? (
              <ParseErrorHint parseError={parseError} />
            ) : isJson ? (
              <JsonCoveragePanel
                analysis={analysis}
                activeKey={activeKey}
                onSelect={(key) => {
                  selectKey(key);
                  setTab('diff');
                }}
              />
            ) : (
              <CoveragePanel
                analysis={analysis}
                text={text}
                activeKey={activeKey}
                onSelect={(key) => {
                  selectKey(key);
                  setTab('diff');
                }}
              />
            )}
          </div>
        </section>
      </main>

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}

function ParseErrorHint({
  parseError,
}: {
  parseError: { message: string; line: number; col: number };
}) {
  return (
    <div className="json-error-pane" style={{ minHeight: 160 }}>
      <div className="json-error-card">
        <div className="json-error-title">⛔ JSON 解析失败</div>
        <div className="json-error-msg">{parseError.message}</div>
        <div className="json-error-pos">
          第 <b>{parseError.line}</b> 行，第 <b>{parseError.col}</b> 列
        </div>
        <div className="hint">请在「原文 / 结果对照」页修正原文；解析失败时不生成任何脱敏结果。</div>
      </div>
    </div>
  );
}
