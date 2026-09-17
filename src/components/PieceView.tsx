import type { Hit } from '../types';
import type { Piece } from '../lib/highlight';

interface PieceViewProps {
  pieces: Piece[];
  hitById: Map<string, Hit>;
  activeKey: string | null;
  hoveredKey: string | null;
  onSelect: (key: string) => void;
  onHover: (key: string | null) => void;
}

/** 将连续文本分片渲染为 <pre> 内的高亮标记 */
export function PieceView({
  pieces,
  hitById,
  activeKey,
  hoveredKey,
  onSelect,
  onHover,
}: PieceViewProps) {
  if (pieces.length === 0) {
    return <span style={{ color: '#94a3b8' }}>（空文本）</span>;
  }

  return (
    <>
      {pieces.map((p, i) => {
        const adopted = p.adoptedIds.map((id) => hitById.get(id)).filter((h): h is Hit => !!h);
        const rejected = p.hitIds
          .filter((id) => !p.adoptedIds.includes(id))
          .map((id) => hitById.get(id))
          .filter((h): h is Hit => !!h);

        const primary = adopted[0] ?? rejected[0];
        const color = primary?.color ?? '#888888';
        const pieceKey = primary ? primary.id : p.coverageId;

        const isActive =
          (!!activeKey && p.hitIds.includes(activeKey)) ||
          (!!activeKey && p.coverageId === activeKey);
        const isHovered =
          !isActive &&
          ((!!hoveredKey && p.hitIds.includes(hoveredKey)) ||
            (!!hoveredKey && p.coverageId === hoveredKey));

        const classNames = ['hl'];
        if (adopted.length > 0) classNames.push('hl-adopted');
        if (rejected.length > 0) classNames.push('hl-rejected');
        if (p.coverage) classNames.push('hl-coverage');
        if (isActive) classNames.push('active');
        if (isHovered) classNames.push('hovered');

        const titleParts: string[] = [];
        for (const h of adopted) {
          titleParts.push(`采用 #${h.priority} ${h.ruleName}：「${h.text}」→「${h.replacement}」`);
        }
        for (const h of rejected) {
          titleParts.push(`舍弃 #${h.priority} ${h.ruleName}：${h.rejectedReason ?? '重叠'}`);
        }
        if (p.coverage) titleParts.push('未覆盖的邮箱/手机号/身份证样式');

        if (classNames.length === 1) {
          return <span key={i}>{p.text}</span>;
        }

        return (
          <mark
            key={i}
            className={classNames.join(' ')}
            style={{ ['--hl-color' as string]: color }}
            title={titleParts.join('\n')}
            data-hit={primary ? pieceKey : undefined}
            data-cov={!primary && p.coverageId ? p.coverageId : undefined}
            onClick={(e) => {
              e.stopPropagation();
              if (pieceKey) onSelect(pieceKey);
            }}
            onMouseEnter={() => pieceKey && onHover(pieceKey)}
            onMouseLeave={() => onHover(null)}
          >
            {p.text}
          </mark>
        );
      })}
    </>
  );
}
