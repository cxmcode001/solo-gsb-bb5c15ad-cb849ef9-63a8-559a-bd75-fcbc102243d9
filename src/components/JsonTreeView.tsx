import type { CoverageItem, Hit, JsonViewNode } from '../types';

/** 序列化为 JSON 字符串字面量的内部部分（引号外）。转义是逐字符局部的，可对分片分别转义 */
const jsonLit = (s: string): string => JSON.stringify(s).slice(1, -1);

interface JsonTreeViewProps {
  node: JsonViewNode;
  /** original：展示原始字符串（含引号）；result：展示脱敏后字符串（含引号） */
  variant: 'original' | 'result';
  hitById: Map<string, Hit>;
  coverage: CoverageItem[];
  activeKey: string | null;
  hoveredKey: string | null;
  onSelect: (key: string) => void;
  onHover: (key: string | null) => void;
}

/**
 * 以格式化 JSON 的形式渲染语法树：
 * - 键名、数字、布尔、null 始终为原文切片，不参与任何匹配；
 * - 仅字符串值内部叠加 采用/舍弃/未覆盖 高亮（每个值独立裁决，坐标相对值内部）。
 */
export function JsonTreeView(props: JsonTreeViewProps) {
  return (
    <>
      {renderNode(props.node, 0, props)}
      {'\n'}
    </>
  );
}

function renderNode(node: JsonViewNode, depth: number, props: JsonTreeViewProps) {
  const { variant } = props;
  const keyPrefix = node.keyToken ? (
    <>
      <span className="json-key">{node.keyToken}</span>
      {': '}
    </>
  ) : null;

  switch (node.kind) {
    case 'object': {
      const children = node.children ?? [];
      if (children.length === 0) return <>{keyPrefix}{'{}'}</>;
      return (
        <>
          {keyPrefix}
          {'{'}
          {'\n'}
          {children.map((child, i) => (
            <span key={i}>
              {'  '.repeat(depth + 1)}
              {renderNode(child, depth + 1, props)}
              {i < children.length - 1 ? ',' : ''}
              {'\n'}
            </span>
          ))}
          {'  '.repeat(depth)}
          {'}'}
        </>
      );
    }
    case 'array': {
      const children = node.children ?? [];
      if (children.length === 0) return <>{keyPrefix}{'[]'}</>;
      return (
        <>
          {keyPrefix}
          {'['}
          {'\n'}
          {children.map((child, i) => (
            <span key={i}>
              {'  '.repeat(depth + 1)}
              {renderNode(child, depth + 1, props)}
              {i < children.length - 1 ? ',' : ''}
              {'\n'}
            </span>
          ))}
          {'  '.repeat(depth)}
          {']'}
        </>
      );
    }
    case 'number':
    case 'boolean':
    case 'null':
      return (
        <>
          {keyPrefix}
          <span className={`json-literal json-${node.kind}`}>{node.raw}</span>
        </>
      );
    case 'string': {
      const field = node.field!;
      const value = variant === 'original' ? field.value : field.analysis.output;
      return (
        <>
          {keyPrefix}
          <span className="json-string">
            &quot;
            <StringValue node={node} variant={variant} value={value} props={props} />
            &quot;
          </span>
        </>
      );
    }
  }
}

function StringValue({
  node,
  variant,
  value,
  props,
}: {
  node: JsonViewNode;
  variant: 'original' | 'result';
  value: string;
  props: JsonTreeViewProps;
}) {
  const field = node.field!;
  const { hitById, coverage, activeKey, hoveredKey, onSelect, onHover } = props;

  // 仅取当前字段的命中与未覆盖候选，绝不跨字段（重复键 Pointer 相同，用 fid 区分）
  const fieldCov = coverage.filter((c) => c.fid === field.fid);

  // 结果视图：按替换分片渲染（plain / replacement）；原文视图：整个值按原文渲染
  if (variant === 'result') {
    return (
      <>
        {field.analysis.segments.map((seg, i) => {
          if (seg.kind === 'replacement') {
            const hit = hitById.get(seg.hitId!);
            return (
              <Highlight
                key={i}
                text={seg.text}
                adopted={hit ? [hit] : []}
                rejected={[]}
                coverage={false}
                covKey={null}
                escape
                activeKey={activeKey}
                hoveredKey={hoveredKey}
                onSelect={onSelect}
                onHover={onHover}
              />
            );
          }
          return (
            <PlainWithMarks
              key={i}
              text={value.slice(seg.start, seg.end)}
              segStart={seg.start}
              field={node}
              fieldCov={fieldCov}
              props={props}
            />
          );
        })}
      </>
    );
  }

  // 原文视图：值内按命中/候选区间叠加标记
  return (
    <OriginalString
      text={field.value}
      field={node}
      fieldCov={fieldCov}
      hitById={hitById}
      activeKey={activeKey}
      hoveredKey={hoveredKey}
      onSelect={onSelect}
      onHover={onHover}
    />
  );
}

/** 结果视图中 plain 分片：仍可叠加舍弃命中（可见部分）与未覆盖标记 */
function PlainWithMarks({
  text,
  segStart,
  field,
  fieldCov,
  props,
}: {
  text: string;
  segStart: number;
  field: JsonViewNode;
  fieldCov: CoverageItem[];
  props: JsonTreeViewProps;
}) {
  const rejectedAll = field.field!.analysis.hits.filter((h) => !h.adopted);
  const segEnd = segStart + text.length;

  // 收集与本分片相交的区间切分点
  const points = new Set<number>([segStart, segEnd]);
  for (const h of rejectedAll) {
    if (h.start < segEnd && segStart < h.end) {
      points.add(Math.max(segStart, h.start));
      points.add(Math.min(segEnd, h.end));
    }
  }
  for (const c of fieldCov) {
    if (c.start < segEnd && segStart < c.end) {
      points.add(Math.max(segStart, c.start));
      points.add(Math.min(segEnd, c.end));
    }
  }
  const bounds = [...points].sort((a, b) => a - b);
  const out: React.ReactNode[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const s = bounds[i];
    const e = bounds[i + 1];
    if (s < segStart || e > segEnd || s >= e) continue;
    const rejected = rejectedAll.filter((h) => h.start <= s && e <= h.end);
    const cov = fieldCov.find((c) => c.start <= s && e <= c.end);
    out.push(
      <Highlight
        key={i}
        text={text.slice(s - segStart, e - segStart)}
        adopted={[]}
        rejected={rejected
          .map((h) => props.hitById.get(h.id))
          .filter((h): h is Hit => !!h)}
        coverage={!!cov}
        covKey={cov ? (cov.covKey ?? `cov-${cov.start}-${cov.end}`) : null}
        escape
        activeKey={props.activeKey}
        hoveredKey={props.hoveredKey}
        onSelect={props.onSelect}
        onHover={props.onHover}
      />,
    );
  }
  if (out.length === 0) return <>{jsonLit(text)}</>;
  return <>{out}</>;
}

/** 原文视图中单个字符串值：采用/舍弃/未覆盖多层叠加 */
function OriginalString({
  text,
  field,
  fieldCov,
  hitById,
  activeKey,
  hoveredKey,
  onSelect,
  onHover,
}: {
  text: string;
  field: JsonViewNode;
  fieldCov: CoverageItem[];
  hitById: Map<string, Hit>;
  activeKey: string | null;
  hoveredKey: string | null;
  onSelect: (key: string) => void;
  onHover: (key: string | null) => void;
}) {
  const hits = field.field!.analysis.hits;
  const adopted = hits.filter((h) => h.adopted);
  const rejected = hits.filter((h) => !h.adopted);

  const points = new Set<number>([0, text.length]);
  for (const h of hits) {
    points.add(Math.max(0, h.start));
    points.add(Math.min(text.length, h.end));
  }
  for (const c of fieldCov) {
    points.add(Math.max(0, c.start));
    points.add(Math.min(text.length, c.end));
  }
  const bounds = [...points].sort((a, b) => a - b);
  const out: React.ReactNode[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const s = bounds[i];
    const e = bounds[i + 1];
    if (s >= e) continue;
    const hereAdopted = adopted
      .filter((h) => h.start <= s && e <= h.end)
      .map((h) => hitById.get(h.id))
      .filter((h): h is Hit => !!h);
    const hereRejected = rejected
      .filter((h) => h.start <= s && e <= h.end)
      .map((h) => hitById.get(h.id))
      .filter((h): h is Hit => !!h);
    const cov = fieldCov.find((c) => c.start <= s && e <= c.end);
    out.push(
      <Highlight
        key={i}
        text={text.slice(s, e)}
        adopted={hereAdopted}
        rejected={hereRejected}
        coverage={!!cov}
        covKey={cov ? (cov.covKey ?? `cov-${cov.start}-${cov.end}`) : null}
        escape
        activeKey={activeKey}
        hoveredKey={hoveredKey}
        onSelect={onSelect}
        onHover={onHover}
      />,
    );
  }
  return <>{out}</>;
}

interface HighlightProps {
  text: string;
  adopted: Hit[];
  rejected: Hit[];
  coverage: boolean;
  covKey: string | null;
  /** 位于 JSON 字符串字面量内部时，按 JSON 规则转义显示 */
  escape?: boolean;
  activeKey: string | null;
  hoveredKey: string | null;
  onSelect: (key: string) => void;
  onHover: (key: string | null) => void;
}

function Highlight({
  text,
  adopted,
  rejected,
  coverage,
  covKey,
  escape,
  activeKey,
  hoveredKey,
  onSelect,
  onHover,
}: HighlightProps) {
  const shown = escape ? jsonLit(text) : text;
  const primary = adopted[0] ?? rejected[0];
  const color = primary?.color ?? '#888888';
  const pieceKey = primary ? primary.id : covKey;

  const classNames = ['hl'];
  if (adopted.length > 0) classNames.push('hl-adopted');
  if (rejected.length > 0) classNames.push('hl-rejected');
  if (coverage) classNames.push('hl-coverage');
  const isActive =
    (!!activeKey && (!!primary && activeKey === primary.id)) ||
    (!!activeKey && !!covKey && activeKey === covKey);
  const isHovered =
    !isActive &&
    ((!!hoveredKey && !!primary && hoveredKey === primary.id) ||
      (!!hoveredKey && !!covKey && hoveredKey === covKey));
  if (isActive) classNames.push('active');
  if (isHovered) classNames.push('hovered');

  const titleParts: string[] = [];
  for (const h of adopted) {
    titleParts.push(`采用 #${h.priority} ${h.ruleName}：「${h.text}」→「${h.replacement}」`);
  }
  for (const h of rejected) {
    titleParts.push(`舍弃 #${h.priority} ${h.ruleName}：${h.rejectedReason ?? '重叠'}`);
  }
  if (coverage) titleParts.push('未覆盖的邮箱/手机号/身份证样式');

  if (classNames.length === 1) return <>{shown}</>;

  return (
    <mark
      className={classNames.join(' ')}
      style={{ ['--hl-color' as string]: color }}
      title={titleParts.join('\n')}
      data-hit={primary ? pieceKey : undefined}
      data-cov={!primary && covKey ? covKey : undefined}
      onClick={(e) => {
        e.stopPropagation();
        if (pieceKey) onSelect(pieceKey);
      }}
      onMouseEnter={() => pieceKey && onHover(pieceKey)}
      onMouseLeave={() => onHover(null)}
    >
      {shown}
    </mark>
  );
}
