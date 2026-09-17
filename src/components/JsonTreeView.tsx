import type { Hit, JsonField } from '../types';
import { buildOriginalPieces, buildResultPieces } from '../lib/highlight';
import type { Piece } from '../lib/highlight';
import { escapeJsonString, formatPointer } from '../lib/json';
import { PieceView } from './PieceView';

interface JsonTreeViewProps {
  /** original：原文树（高亮采用/舍弃/未覆盖）；masked：脱敏结果树 */
  variant: 'original' | 'masked';
  /** 与树同构的已解析 JSON（original=原文树，masked=重建树） */
  tree: unknown;
  fields: JsonField[];
  hitById: Map<string, Hit>;
  activeKey: string | null;
  hoveredKey: string | null;
  onSelect: (key: string) => void;
  onHover: (key: string | null) => void;
}

/**
 * 把「未转义字符串值坐标」上的分片映射为 JSON 字面量坐标：
 * 按分片边界切开后逐段转义。转义序列不会被切碎（边界都是匹配区间端点，
 * 而任何转义字符都完整落在某个分片内部），因此逐段 JSON.stringify 与
 * 整体转义结果逐字符一致。
 */
function toEscapedPieces(pieces: Piece[]): Piece[] {
  return pieces.map((p) => ({ ...p, text: escapeJsonString(p.text) }));
}

export function JsonTreeView({
  variant,
  tree,
  fields,
  hitById,
  activeKey,
  hoveredKey,
  onSelect,
  onHover,
}: JsonTreeViewProps) {
  const fieldByPointer = new Map(fields.map((f) => [f.pointer, f]));
  const viewProps = { hitById, activeKey, hoveredKey, onSelect, onHover };

  const renderStringValue = (pointer: string) => {
    const field = fieldByPointer.get(pointer);
    if (!field) return null;
    const { value, analysis } = field;
    if (value === '') return null;

    const pieces =
      variant === 'original'
        ? buildOriginalPieces(value, analysis.hits, analysis.coverage)
        : buildResultPieces(value, analysis.segments, analysis.hits, analysis.coverage);

    return <PieceView pieces={toEscapedPieces(pieces)} {...viewProps} />;
  };

  const renderNode = (node: unknown, path: (string | number)[]): React.ReactNode => {
    if (typeof node === 'string') {
      return (
        <span className="jv-string">
          "
          {node !== '' && renderStringValue(formatPointer(path))}
          "
        </span>
      );
    }
    if (Array.isArray(node)) {
      if (node.length === 0) return <span className="jv-punct">[]</span>;
      return (
        <span className="jv-punct">
          [
          {'\n'}
          {node.map((item, i) => (
            <span key={i}>
              {'  '.repeat(path.length + 1)}
              {renderNode(item, [...path, i])}
              {i < node.length - 1 ? ',' : ''}
              {'\n'}
            </span>
          ))}
          {'  '.repeat(path.length)}]
        </span>
      );
    }
    if (node !== null && typeof node === 'object') {
      const entries = Object.entries(node as Record<string, unknown>);
      if (entries.length === 0) return <span className="jv-punct">{'{}'}</span>;
      return (
        <span className="jv-punct">
          {'{'}
          {'\n'}
          {entries.map(([key, value], i) => (
            <span key={key}>
              {'  '.repeat(path.length + 1)}
              <span className="jv-key">{JSON.stringify(key)}</span>
              {': '}
              {renderNode(value, [...path, key])}
              {i < entries.length - 1 ? ',' : ''}
              {'\n'}
            </span>
          ))}
          {'  '.repeat(path.length)}
          {'}'}
        </span>
      );
    }
    // number / boolean / null 原样保留（用 JSON.stringify 保证字面量合法）
    const cls =
      node === null ? 'jv-null' : typeof node === 'boolean' ? 'jv-boolean' : 'jv-number';
    return <span className={cls}>{JSON.stringify(node)}</span>;
  };

  return <>{renderNode(tree, [])}</>;
}
