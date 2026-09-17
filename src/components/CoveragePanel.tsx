import type { Analysis, CoverageItem } from '../types';
import { posToLineCol } from '../lib/highlight';
import { textCoverageKey } from '../lib/engine';

interface CoveragePanelProps {
  analysis: Analysis;
  text: string;
  activeKey: string | null;
  onSelect: (key: string) => void;
}

const KIND_NAME: Record<CoverageItem['kind'], string> = {
  email: '邮箱',
  phone: '手机号',
  idcard: '身份证',
};

export function CoveragePanel({ analysis, text, activeKey, onSelect }: CoveragePanelProps) {
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
          ✅ 未发现漏网的邮箱、手机号或身份证样式。所有疑似敏感信息均已被采用的规则覆盖。
        </div>
      ) : (
        <>
          <p className="hint" style={{ marginTop: 0 }}>
            下列内容疑似敏感信息，但没有被任何“采用”的规则覆盖（已被舍弃的重叠命中不算覆盖）。点击条目可定位到原文。
          </p>
          {items.map((item) => {
            const { line, col } = posToLineCol(text, item.start);
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
                  第 {line} 行第 {col} 列
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
