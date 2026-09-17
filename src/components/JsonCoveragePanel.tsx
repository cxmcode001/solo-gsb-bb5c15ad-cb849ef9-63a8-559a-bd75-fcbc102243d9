import type { CoverageItem, JsonAnalysis } from '../types';
import { posToLineCol } from '../lib/highlight';
import { textCoverageKey } from '../lib/engine';

interface JsonCoveragePanelProps {
  analysis: JsonAnalysis;
  activeKey: string | null;
  onSelect: (key: string) => void;
}

const KIND_NAME: Record<CoverageItem['kind'], string> = {
  email: '邮箱',
  phone: '手机号',
  idcard: '身份证',
};

const rootLabel = (pointer: string) => (pointer === '' ? '（根字符串）' : pointer);

/** JSON 模式未覆盖检查：标注每条候选所属字段的 JSON Pointer 与值内行列 */
export function JsonCoveragePanel({ analysis, activeKey, onSelect }: JsonCoveragePanelProps) {
  const items = analysis.coverage;
  const counts = {
    email: items.filter((i) => i.kind === 'email').length,
    phone: items.filter((i) => i.kind === 'phone').length,
    idcard: items.filter((i) => i.kind === 'idcard').length,
  };

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
          ✅ 所有字符串值中均未发现漏网的邮箱、手机号或身份证样式。
        </div>
      ) : (
        <>
          <p className="hint" style={{ marginTop: 0 }}>
            下列内容疑似敏感信息，但没有被所在字段中任何“采用”的规则覆盖。检测严格限制在单个字符串值内部，不跨字段。
          </p>
          {items.map((item) => {
            const field = analysis.fields.find((f) => f.fid === item.fid);
            const { line, col } = field
              ? posToLineCol(field.value, item.start)
              : { line: 1, col: 1 };
            const key = textCoverageKey(item);
            return (
              <div
                key={key}
                className={`coverage-item ${activeKey === key ? 'active' : ''}`}
                onClick={() => onSelect(key)}
              >
                <span className="tag kind">{KIND_NAME[item.kind]}</span>
                <code>{item.text}</code>
                <span style={{ flex: 1 }} />
                <span className="meta">
                  <code className="json-pointer">{rootLabel(item.pointer ?? '')}</code> · 值内第{' '}
                  {line} 行第 {col} 列
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
