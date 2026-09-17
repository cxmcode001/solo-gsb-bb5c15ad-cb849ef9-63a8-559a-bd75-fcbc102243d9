import type { Hit, Segment } from '../types';

/** 渲染分片：一段文本上可叠加采用/舍弃/未覆盖等多层标记 */
export interface Piece {
  text: string;
  /** 原文坐标（结果分片中 plain 段沿用原文坐标，替换段指向被替换区间） */
  start: number;
  end: number;
  hitIds: string[];
  adoptedIds: string[];
  coverage: boolean;
  /** 覆盖分片所属未覆盖候选的联动 key（cov-start-end） */
  coverageId: string | null;
}

interface Range {
  start: number;
  end: number;
  /** JSON 模式下所属字段的 JSON Pointer，用于跨字段区分同一局部坐标 */
  pointer?: string;
}

/** 在 [baseStart, baseEnd) 内用 ranges 做不重叠切分（同一层 ranges 已互不相交） */
function splitRanges(baseStart: number, baseEnd: number, ranges: Range[]): Array<Range & { on: boolean }> {
  const points = new Set<number>([baseStart, baseEnd]);
  for (const r of ranges) {
    const s = Math.max(baseStart, r.start);
    const e = Math.min(baseEnd, r.end);
    if (s < e) {
      points.add(s);
      points.add(e);
    }
  }
  const sorted = [...points].sort((a, b) => a - b);
  const out: Array<Range & { on: boolean }> = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const s = sorted[i];
    const e = sorted[i + 1];
    if (s >= baseEnd || e <= baseStart) continue;
    const on = ranges.some((r) => r.start <= s && e <= r.end);
    out.push({ start: s, end: e, on });
  }
  return out;
}

function emptyPiece(start: number, end: number): Piece {
  return {
    text: '',
    start,
    end,
    hitIds: [],
    adoptedIds: [],
    coverage: false,
    coverageId: null,
  };
}

export const coverageRangeKey = (r: Range) =>
  r.pointer ? `cov-${r.pointer}-${r.start}-${r.end}` : `cov-${r.start}-${r.end}`;

/**
 * 原文分片：采用命中与舍弃命中都基于原始坐标叠加。
 * 同一点上舍弃命中可能有多条（同起始冲突），全部保留用于联动。
 */
export function buildOriginalPieces(
  text: string,
  hits: Hit[],
  coverage: Array<Range>,
): Piece[] {
  if (text === '') return [];
  const adopted = hits.filter((h) => h.adopted).map((h) => ({ start: h.start, end: h.end }));
  const rejected = hits.filter((h) => !h.adopted).map((h) => ({ start: h.start, end: h.end }));

  // 第一层：采用区间切分
  const adoptedSplits = splitRanges(0, text.length, adopted);
  const pieces: Piece[] = [];

  for (const part of adoptedSplits) {
    const rejSplits = splitRanges(part.start, part.end, rejected);
    const covSplits = splitRanges(part.start, part.end, coverage);
    // 合并 rej 与 coverage 两层的边界
    const points = new Set<number>([part.start, part.end]);
    for (const r of [...rejSplits, ...covSplits]) {
      points.add(r.start);
      points.add(r.end);
    }
    const bounds = [...points].sort((a, b) => a - b);
    for (let i = 0; i + 1 < bounds.length; i++) {
      const s = bounds[i];
      const e = bounds[i + 1];
      const piece = emptyPiece(s, e);
      piece.text = text.slice(s, e);
      if (part.on) {
        const hit = hits.find((h) => h.adopted && h.start <= s && e <= h.end)!;
        piece.hitIds.push(hit.id);
        piece.adoptedIds.push(hit.id);
      }
      for (const h of hits) {
        if (!h.adopted && h.start <= s && e <= h.end) piece.hitIds.push(h.id);
      }
      const cov = coverage.find((c) => c.start <= s && e <= c.end);
      piece.coverage = !!cov;
      piece.coverageId = cov ? coverageRangeKey(cov) : null;
      pieces.push(piece);
    }
  }
  return pieces;
}

/**
 * 结果分片：替换片段携带对应采用命中；舍弃命中的可见部分映射到结果中
 * （被替换吞掉的部分自然消失，正好体现“生成内容不再被命中”）。
 */
export function buildResultPieces(
  text: string,
  segments: Segment[],
  hits: Hit[],
  coverage: Array<Range>,
): Piece[] {
  const rejected = hits.filter((h) => !h.adopted);
  const pieces: Piece[] = [];

  for (const seg of segments) {
    if (seg.kind === 'plain') {
      const rejSplits = splitRanges(seg.start, seg.end, rejected.map((h) => ({ start: h.start, end: h.end })));
      const covSplits = splitRanges(seg.start, seg.end, coverage);
      const points = new Set<number>([seg.start, seg.end]);
      for (const r of [...rejSplits, ...covSplits]) {
        points.add(r.start);
        points.add(r.end);
      }
      const bounds = [...points].sort((a, b) => a - b);
      for (let i = 0; i + 1 < bounds.length; i++) {
        const s = bounds[i];
        const e = bounds[i + 1];
        const piece = emptyPiece(s, e);
        piece.text = text.slice(s, e);
        for (const h of rejected) {
          if (h.start <= s && e <= h.end) piece.hitIds.push(h.id);
        }
        const cov = coverage.find((c) => c.start <= s && e <= c.end);
        piece.coverage = !!cov;
        piece.coverageId = cov ? coverageRangeKey(cov) : null;
        pieces.push(piece);
      }
    } else {
      const piece = emptyPiece(seg.start, seg.end);
      piece.text = seg.text;
      piece.hitIds.push(seg.hitId!);
      piece.adoptedIds.push(seg.hitId!);
      pieces.push(piece);
    }
  }
  return pieces;
}

/** 字符偏移 -> 1 起始的行/列 */
export function posToLineCol(text: string, pos: number): { line: number; col: number } {
  let line = 1;
  let col = 1;
  for (let i = 0; i < pos && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}
