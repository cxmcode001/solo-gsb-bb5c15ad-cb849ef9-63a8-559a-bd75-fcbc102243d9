import type {
  Analysis,
  CoverageItem,
  Hit,
  Rule,
  RuleError,
  Segment,
  SensitiveKind,
} from '../types';

let hitSeq = 0;
const nextHitId = () => `hit-${++hitSeq}`;
/** 规范化标志：强制 g，去重，过滤非法字符 */
export function normalizeFlags(flags: string): string {
  const allowed = new Set(['g', 'i', 'm', 's', 'u', 'y']);
  const set = new Set<string>(['g']);
  for (const ch of flags) {
    if (allowed.has(ch)) set.add(ch);
  }
  // u 与 y 互斥时以用户输入为准（这里不做强制剔除，交由浏览器报错）
  return ['g', 'i', 'm', 's', 'u', 'y'].filter((f) => set.has(f)).join('');
}

/**
 * 展开替换模板：
 *   $$        -> 字面量 $
 *   $&        -> 整段命中
 *   $1..$99   -> 对应捕获组（不存在则为空串）
 */
export function expandTemplate(template: string, match: RegExpMatchArray): string {
  let out = '';
  for (let i = 0; i < template.length; i++) {
    const ch = template[i];
    if (ch !== '$' || i + 1 >= template.length) {
      out += ch;
      continue;
    }
    const next = template[i + 1];
    if (next === '$') {
      out += '$';
      i++;
    } else if (next === '&') {
      out += match[0];
      i++;
    } else if (next >= '0' && next <= '9') {
      // 最多读取两位数字
      let digits = next;
      if (i + 2 < template.length && /[0-9]/.test(template[i + 2])) {
        digits += template[i + 2];
      }
      const idx = parseInt(digits, 10);
      if (idx === 0) {
        out += match[0];
      } else {
        out += match[idx] ?? '';
      }
      i += digits.length;
    } else {
      out += ch;
    }
  }
  return out;
}

interface RawMatch {
  rule: Rule;
  priority: number;
  start: number;
  end: number;
  match: RegExpMatchArray;
}

function buildRegExp(rule: Rule): RegExp {
  return new RegExp(rule.pattern, normalizeFlags(rule.flags));
}

/** 收集一条规则的全部命中（零宽命中保留，便于解释） */
function collectCompiledMatches(
  rule: Rule,
  priority: number,
  re: RegExp,
  text: string,
): RawMatch[] {
  const result: RawMatch[] = [];
  if (rule.scope === 'line') {
    // 逐行执行：^ $ 锚定单行，命中不跨行
    let lineStart = 0;
    for (const line of text.split('\n')) {
      const lineRe = new RegExp(re.source, re.flags);
      let m: RegExpExecArray | null;
      while ((m = lineRe.exec(line)) !== null) {
        result.push({
          rule,
          priority,
          start: lineStart + m.index,
          end: lineStart + m.index + m[0].length,
          match: m,
        });
        if (m[0] === '') lineRe.lastIndex++;
      }
      lineStart += line.length + 1;
    }
  } else {
    // 每段文本使用独立的 RegExp 实例，避免 lastIndex 在字段间串扰
    const ownRe = new RegExp(re.source, re.flags);
    let m: RegExpExecArray | null;
    while ((m = ownRe.exec(text)) !== null) {
      result.push({
        rule,
        priority,
        start: m.index,
        end: m.index + m[0].length,
        match: m,
      });
      if (m[0] === '') ownRe.lastIndex++;
    }
  }
  return result;
}

/**
 * 重叠裁决：
 * 1) 全部规则先在“原文”上匹配（生成内容不会再被扫描）；
 * 2) 按 规则优先级（列表序号）→ 起始位置 → 结束位置 排序；
 * 3) 顺序领取字符区间，与已采用区间重叠者舍弃并给出解释。
 */
function resolveHits(raw: RawMatch[]): Hit[] {
  const sorted = [...raw].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.start !== b.start) return a.start - b.start;
    return b.end - a.end;
  });

  const claimed: Array<{ start: number; end: number; hit: Hit }> = [];
  const hits: Hit[] = [];

  for (const rm of sorted) {
    const replacement = expandTemplate(rm.rule.template, rm.match);
    const groups: string[] = [];
    for (let g = 1; g < rm.match.length; g++) groups.push(rm.match[g] ?? '');

    const hit: Hit = {
      id: nextHitId(),
      ruleId: rm.rule.id,
      ruleName: rm.rule.name,
      color: rm.rule.color,
      priority: rm.priority,
      start: rm.start,
      end: rm.end,
      text: rm.match[0],
      groups,
      replacement,
      adopted: false,
    };

    // 同起始位置（含零宽）也视为冲突：排序靠前者胜出
    const conflict = claimed.find((c) => {
      if (rm.start === rm.end || c.start === c.end) {
        return rm.start <= c.end && c.start <= rm.end;
      }
      return rm.start < c.end && c.start < rm.end;
    });

    if (conflict) {
      const sameStart = conflict.hit.start === rm.start;
      hit.rejectedReason = sameStart
        ? `与 #${conflict.hit.priority}「${conflict.hit.ruleName}」起始位置相同（${rm.start}），规则 #${conflict.hit.priority} 优先级更高`
        : `区间 [${rm.start}, ${rm.end}) 与已采用命中「${conflict.hit.text}」(#${conflict.hit.priority} ${conflict.hit.ruleName}, [${conflict.hit.start}, ${conflict.hit.end})) 重叠`;
    } else {
      hit.adopted = true;
      claimed.push({ start: rm.start, end: rm.end, hit });
    }
    hits.push(hit);
  }

  // 回到“规则顺序 → 起始位置”的阅读顺序，便于解释面板阅读
  hits.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.start - b.start;
  });
  return hits;
}

/** 以采用命中为切分点，一次性拼接最终结果 */
function buildSegments(text: string, hits: Hit[]): Segment[] {
  const adopted = hits
    .filter((h) => h.adopted)
    .sort((a, b) => a.start - b.start);

  const segments: Segment[] = [];
  let cursor = 0;
  for (const h of adopted) {
    if (h.start > cursor) {
      segments.push({
        start: cursor,
        end: h.start,
        kind: 'plain',
        text: text.slice(cursor, h.start),
      });
    }
    segments.push({
      start: h.start,
      end: h.end,
      kind: 'replacement',
      text: h.replacement,
      hitId: h.id,
    });
    cursor = h.end;
  }
  if (cursor < text.length) {
    segments.push({
      start: cursor,
      end: text.length,
      kind: 'plain',
      text: text.slice(cursor),
    });
  }
  return segments;
}

/* ------------------------- 未覆盖敏感信息检测 ------------------------- */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// 手机号：11 位 1 开头，第二位 3-9
const PHONE_RE = /(?<!\d)1[3-9]\d{9}(?!\d)/g;
// 身份证：18 位（末位 X），尝试校验出生日期与校验码
const IDCARD_RE = /(?<!\d)\d{17}[\dXx](?!\d)/g;

function isValidBirth(s: string): boolean {
  const year = parseInt(s.slice(6, 10), 10);
  const month = parseInt(s.slice(10, 12), 10);
  const day = parseInt(s.slice(12, 14), 10);
  if (year < 1900 || year > new Date().getFullYear()) return false;
  if (month < 1 || month > 12) return false;
  const daysInMonth = new Date(year, month, 0).getDate();
  return day >= 1 && day <= daysInMonth;
}

/** GB 11643 校验码 */
export function idChecksumOk(s: string): boolean {
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const codes = '10X98765432';
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += parseInt(s[i], 10) * weights[i];
  return codes[sum % 11] === s[17].toUpperCase();
}

function detectCandidates(text: string): CoverageItem[] {
  const found: Array<CoverageItem & { kind: SensitiveKind }> = [];

  for (const m of text.matchAll(EMAIL_RE)) {
    found.push({ kind: 'email', start: m.index!, end: m.index! + m[0].length, text: m[0] });
  }
  for (const m of text.matchAll(PHONE_RE)) {
    found.push({ kind: 'phone', start: m.index!, end: m.index! + m[0].length, text: m[0] });
  }
  for (const m of text.matchAll(IDCARD_RE)) {
    if (isValidBirth(m[0])) {
      found.push({
        kind: 'idcard',
        start: m.index!,
        end: m.index! + m[0].length,
        text: m[0],
        checksumOk: idChecksumOk(m[0]),
      });
    }
  }

  // 抑制被更长候选包含的项（身份证天然包含 1[3-9] 开头的 11 位手机号样式）
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: typeof found = [];
  for (const item of found) {
    const container = kept.find((k) => k.start <= item.start && item.end <= k.end && k.kind !== item.kind);
    if (!container) kept.push(item);
  }
  kept.sort((a, b) => a.start - b.start);
  return kept;
}

/**
 * 主入口：对原文执行全部启用规则，产出裁决后的命中、一次性替换结果与未覆盖提示。
 */
export function analyze(text: string, rules: Rule[]): Analysis {
  const { compiled, errors } = compileRules(rules);
  return runAnalysis(text, compiled, errors);
}

/** 编译后的启用规则：正则只构造一次，语法错误只记录一次 */
export interface CompiledRule {
  rule: Rule;
  /** 规则列表序号（从 1 开始），数值越小优先级越高 */
  priority: number;
  re: RegExp;
}

/**
 * 编译启用规则：按列表顺序分配优先级；
 * 空 pattern 或正则构造失败的规则被跳过并记录一条错误。
 */
export function compileRules(rules: Rule[]): {
  compiled: CompiledRule[];
  errors: RuleError[];
} {
  const compiled: CompiledRule[] = [];
  const errors: RuleError[] = [];
  rules.forEach((rule, i) => {
    if (!rule.enabled) return;
    if (!rule.pattern) {
      errors.push({ ruleId: rule.id, message: '正则表达式不能为空' });
      return;
    }
    try {
      compiled.push({ rule, priority: i + 1, re: buildRegExp(rule) });
    } catch (err) {
      errors.push({
        ruleId: rule.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
  return { compiled, errors };
}

/**
 * 在一段文本上执行全部已编译规则。
 * 纯文本模式对整段文本执行一次；JSON 模式对每个字符串字段各执行一次，
 * 命中区间都是「该字段值内的局部坐标」，字段之间天然不发生跨字段匹配。
 */
export function runAnalysis(
  text: string,
  compiled: CompiledRule[],
  errors: RuleError[] = [],
): Analysis {
  const raw: RawMatch[] = [];
  for (const { rule, priority, re } of compiled) {
    raw.push(...collectCompiledMatches(rule, priority, re, text));
  }

  const hits = resolveHits(raw);
  const segments = buildSegments(text, hits);
  const output = segments.map((s) => s.text).join('');

  // 未覆盖 = 检测到但未落入任何“采用命中”区间的候选
  const adoptedRanges = hits.filter((h) => h.adopted).map((h) => ({ start: h.start, end: h.end }));
  const coveredBy = (start: number, end: number) =>
    adoptedRanges.some((r) => r.start <= start && end <= r.end);

  const coverage = detectCandidates(text).filter((c) => !coveredBy(c.start, c.end));

  const adoptedCount = hits.filter((h) => h.adopted).length;
  return {
    hits,
    segments,
    output,
    errors,
    coverage,
    stats: {
      total: hits.length,
      adopted: adoptedCount,
      rejected: hits.length - adoptedCount,
    },
  };
}
