import type { Analysis, CoverageItem, JsonAnalysis, SampleMode } from '../types';
import { posToLineCol } from '../lib/highlight';

interface CoveragePanelProps {
  mode: SampleMode;
  analysis: Analysis;
  json: JsonAnalysis | null;
  text: string;
  activeKey: string | null;
  onSelect: (key: string) => void;
}

const KIND_NAME: Record<CoverageItem['kind'], string> = {
  email: '邮箱',
  phone: '手机号',
  idcard: '身份证',
};

/**
 * 未覆盖候选不在 hits 中，无法用 hitId 联动。
 * 这里按 pointer + 起始位置合成一个可用于高亮的标识。
 */
export const coverageKey = (item: CoverageItem) =>
  item.pointer
    ? `cov-${item.pointer}-${item.start}-${item.end}`
    : `cov-${item.start}-${item.end}`;

export function CoveragePanel({
  mode,
  analysis,
  json,
  text,
  activeKey,
  onSelect,
}: CoveragePanelProps) {
  const fieldValueByPointer =
    mode === 'json' && json
      ? new Map(json.fields.map((f) => [f.pointer, f.value]))
      : null;

  const items: CoverageItem[] =
    mode === 'json' && json ? json.coverage : analysis.coverage;

  const counts = {
    email: items.filter((i) => i.kind === 'email').length,
    phone: items.filter((i) => i.kind === 'phone').length,
    idcard: items.filter((i) => i.kind === 'idcard').length,
  };

  if (mode === 'json' && json?.parseError) {
    return (
      <div className="json-parse-error">
        <div className="json-parse-error-title">❌ JSON 解析失败，未执行任何检查</div>
        <div className="json-parse-error-pos">
          第 <b>{json.parseError.line}</b> 行第 <b>{json.parseError.col}</b> 列（字符偏移{' '}
          {json.parseError.pos}）
        </div>
        <pre className="json-parse-error-msg">{json.parseError.message}</pre>
      </div>
    );
  }

  return (
    <div>
      <div className="coverage-summary">
        <div className={`coverage-card ${counts.email > 0 ? 'danger' : ''}`}>
          <div className="num">{counts.email}</div>
          <div className="label">未覆盖邮箱</div>
        </div>
        <div className={`coverage-card ${counts.phone > 0 ? 'danger' : ''}`}>
          <div className="num">{counts.phone}</div>
          <div className="label">未覆盖手机号</div>
        </div>
        <div className={`coverage-card ${counts.idcard > 0 ? 'danger' : ''}`}>
          <div className="num">{counts.idcard}</div>
          <div className="label">未覆盖身份证</div>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="coverage-allclear">
          ✅ {mode === 'json' ? '所有字符串字段中' : ''}未发现漏网的邮箱、手机号或身份证样式。
          所有疑似敏感信息均已被采用的规则覆盖。
        </div>
      ) : (
        <>
          <p className="hint" style={{ marginTop: 0 }}>
            下列内容疑似敏感信息，但没有被任何“采用”的规则覆盖（已被舍弃的重叠命中不算覆盖）。
            点击条目可定位到原文。
          </p>
          {items.map((item) => {
            const containerText =
              mode === 'json' && item.pointer !== undefined
                ? (fieldValueByPointer?.get(item.pointer) ?? '')
                : text;
            const { line, col } = posToLineCol(containerText, item.start);
            const key = coverageKey(item);
            return (
              <div
                key={key}
                className={`coverage-item ${activeKey === key ? 'active' : ''}`}
                onClick={() => onSelect(key)}
              >
                <span className="tag kind">{KIND_NAME[item.kind]}</span>
                <code>{item.text}</code>
                {item.pointer !== undefined && (
                  <span className="json-pointer-tag" title="RFC 6901 JSON Pointer">
                    {item.pointer === '' ? '（顶层字符串）' : item.pointer}
                  </span>
                )}
                <span style={{ flex: 1 }} />
                <span className="meta">
                  {mode === 'json' ? '字段内第' : '第'} {line} 行第 {col} 列
                  {item.kind === 'idcard' && (
                    <> · 校验码{item.checksumOk ? '通过' : '不通过'}</>
                  )}
                </span>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
