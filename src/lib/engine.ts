import type {
  Analysis,
  CoverageItem,
  Hit,
  JsonAnalysis,
  JsonField,
  JsonViewNode,
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
function collectMatches(rule: Rule, priority: number, text: string): RawMatch[] {
  const result: RawMatch[] = [];
  const re = buildRegExp(rule);
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
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      result.push({
        rule,
        priority,
        start: m.index,
        end: m.index + m[0].length,
        match: m,
      });
      if (m[0] === '') re.lastIndex++;
    }
  }
  return result;
}

/**
 * 重叠裁决：
 * 1) 全部规则先在“原文”上匹配（生成内容不会再被扫描）；
 * 2) 按 规则优先级（列表序号）→ 起始位置 → 结束位置 排序；
 * 3) 顺序领取字符区间，与已采用区间重叠者舍弃并给出解释。
 *
 * 注意：坐标完全相对于传入的 text；JSON 模式下对每个字符串值独立调用，
 * 因此禁止跨字段匹配。
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
 * 对一段文本执行全部启用规则，产出裁决后的命中、一次性替换结果与未覆盖提示。
 * 坐标均相对于传入的 text。
 */
export function runAnalysis(text: string, rules: Rule[]): Analysis {
  const errors: RuleError[] = [];
  const enabled = rules
    .map((rule, i) => ({ rule, priority: i + 1 }))
    .filter(({ rule }) => rule.enabled);

  const raw: RawMatch[] = [];
  for (const { rule, priority } of enabled) {
    if (!rule.pattern) {
      errors.push({ ruleId: rule.id, message: '正则表达式不能为空' });
      continue;
    }
    try {
      raw.push(...collectMatches(rule, priority, text));
    } catch (err) {
      errors.push({
        ruleId: rule.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
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

/**
 * 纯文本模式主入口（语义保持不变）。
 */
export function analyze(text: string, rules: Rule[]): Analysis {
  hitSeq = 0;
  return runAnalysis(text, rules);
}

/* ============================ JSON 结构化模式 ============================ */

/** RFC 6901 转义：先 ~ 后 / */
export function escapeJsonPointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * 带位置的 JSON 解析器（JSON.parse 的 reviver 拿不到行列，故手写递归下降）。
 * 输出语法树，每个字符串值携带在原文中的 [start, end)（含两侧引号）。
 */

interface JsonNode {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  start: number;
  end: number;
  /** string：解码后的 JS 字符串 */
  value?: unknown;
  /** object：键值对；array：子节点 */
  members?: Array<{ key: JsonStringNode; value: JsonNode }>;
  elements?: JsonNode[];
}
interface JsonStringNode extends JsonNode {
  type: 'string';
  value: string;
  /** 开引号位置（值起始，用于行列定位） */
  quoteStart: number;
}

class JsonSyntaxError extends Error {
  pos: number;
  constructor(message: string, pos: number) {
    super(message);
    this.name = 'JsonSyntaxError';
    this.pos = pos;
  }
}

class JsonParser {
  private i = 0;

  constructor(private readonly src: string) {}

  parse(): JsonNode {
    this.skipWs();
    const node = this.parseValue();
    this.skipWs();
    if (this.i < this.src.length) {
      throw new JsonSyntaxError(`意外的字符 ${JSON.stringify(this.src[this.i])}`, this.i);
    }
    return node;
  }

  private peek(): string {
    return this.src[this.i];
  }

  private skipWs(): void {
    while (this.i < this.src.length) {
      const c = this.src.charCodeAt(this.i);
      // space, tab, LF, CR
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) this.i++;
      else break;
    }
  }

  private expect(literal: string): void {
    if (this.src.startsWith(literal, this.i)) {
      this.i += literal.length;
      return;
    }
    throw new JsonSyntaxError(`应为 "${literal}"`, this.i);
  }

  private parseValue(): JsonNode {
    this.skipWs();
    if (this.i >= this.src.length) throw new JsonSyntaxError('意外的输入结束', this.i);
    const c = this.peek();
    switch (c) {
      case '{':
        return this.parseObject();
      case '[':
        return this.parseArray();
      case '"':
        return this.parseString();
      case 't':
        return this.parseLiteral('true');
      case 'f':
        return this.parseLiteral('false');
      case 'n':
        return this.parseLiteral('null');
      default:
        if (c === '-' || (c >= '0' && c <= '9')) return this.parseNumber();
        throw new JsonSyntaxError(`意外的字符 ${JSON.stringify(c)}`, this.i);
    }
  }

  private parseLiteral(literal: string): JsonNode {
    const start = this.i;
    this.expect(literal);
    return {
      type: literal === 'true' || literal === 'false' ? 'boolean' : 'null',
      start,
      end: this.i,
      value: literal === 'true',
    };
  }

  private parseObject(): JsonNode {
    const start = this.i;
    this.i++; // {
    const members: Array<{ key: JsonStringNode; value: JsonNode }> = [];
    this.skipWs();
    if (this.peek() === '}') {
      this.i++;
      return { type: 'object', start, end: this.i, members };
    }
    for (;;) {
      this.skipWs();
      if (this.peek() !== '"') throw new JsonSyntaxError('属性名必须是双引号字符串', this.i);
      const key = this.parseString();
      this.skipWs();
      if (this.peek() !== ':') throw new JsonSyntaxError('属性名后应有 ":"', this.i);
      this.i++;
      const value = this.parseValue();
      members.push({ key, value });
      this.skipWs();
      const c = this.peek();
      if (c === ',') {
        this.i++;
        continue;
      }
      if (c === '}') {
        this.i++;
        break;
      }
      throw new JsonSyntaxError('应为 "," 或 "}"', this.i);
    }
    return { type: 'object', start, end: this.i, members };
  }

  private parseArray(): JsonNode {
    const start = this.i;
    this.i++; // [
    const elements: JsonNode[] = [];
    this.skipWs();
    if (this.peek() === ']') {
      this.i++;
      return { type: 'array', start, end: this.i, elements };
    }
    for (;;) {
      const value = this.parseValue();
      elements.push(value);
      this.skipWs();
      const c = this.peek();
      if (c === ',') {
        this.i++;
        continue;
      }
      if (c === ']') {
        this.i++;
        break;
      }
      throw new JsonSyntaxError('应为 "," 或 "]"', this.i);
    }
    return { type: 'array', start, end: this.i, elements };
  }

  private parseString(): JsonStringNode {
    const start = this.i;
    this.i++; // 开引号
    let value = '';
    for (;;) {
      if (this.i >= this.src.length) throw new JsonSyntaxError('字符串未闭合', start);
      const c = this.src[this.i];
      if (c === '"') {
        this.i++;
        return { type: 'string', start, end: this.i, quoteStart: start, value };
      }
      if (c === '\\') {
        value += this.parseEscape();
        continue;
      }
      const code = this.src.charCodeAt(this.i);
      if (code < 0x20) {
        throw new JsonSyntaxError('字符串中存在未转义的控制字符', this.i);
      }
      value += c;
      this.i++;
    }
  }

  private parseEscape(): string {
    this.i++; // 反斜杠
    if (this.i >= this.src.length) throw new JsonSyntaxError('意外的输入结束', this.i);
    const c = this.src[this.i++];
    switch (c) {
      case '"':
        return '"';
      case '\\':
        return '\\';
      case '/':
        return '/';
      case 'b':
        return '\b';
      case 'f':
        return '\f';
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case 'u': {
        const hex = this.src.slice(this.i, this.i + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          throw new JsonSyntaxError('非法的 \\u 转义', this.i - 2);
        }
        this.i += 4;
        return String.fromCharCode(parseInt(hex, 16));
      }
      default:
        throw new JsonSyntaxError(`非法的转义字符 ${JSON.stringify(c)}`, this.i - 1);
    }
  }

  private parseNumber(): JsonNode {
    const start = this.i;
    if (this.peek() === '-') this.i++;
    const readDigits = () => {
      const from = this.i;
      while (this.i < this.src.length && this.src[this.i] >= '0' && this.src[this.i] <= '9') this.i++;
      if (this.i === from) throw new JsonSyntaxError('数字中缺少数位', this.i);
    };
    if (this.peek() === '0') {
      this.i++;
    } else {
      readDigits();
    }
    if (this.peek() === '.') {
      this.i++;
      readDigits();
    }
    if (this.peek() === 'e' || this.peek() === 'E') {
      this.i++;
      if (this.peek() === '+' || this.peek() === '-') this.i++;
      readDigits();
    }
    const raw = this.src.slice(start, this.i);
    return { type: 'number', start, end: this.i, value: Number(raw) };
  }
}

/** 字符偏移 -> 1 起始的行/列 */
function posToLineCol(src: string, pos: number): { line: number; col: number } {
  let line = 1;
  for (let k = 0; k < pos && k < src.length; k++) {
    if (src[k] === '\n') line++;
  }
  const lastNl = src.lastIndexOf('\n', Math.max(0, pos - 1));
  const col = pos - lastNl; // lastNl === -1 时 col = pos + 1
  return { line, col };
}

/** 纯文本模式下未覆盖候选的联动 key（坐标即原文偏移） */
export const textCoverageKey = (item: CoverageItem): string =>
  item.covKey ?? `cov-${item.start}-${item.end}`;

/**
 * JSON 结构化模式：
 * - 原文解析为 JSON；只对对象与数组中的字符串值（以及根字符串）分别运行规则；
 * - 键名、数字、布尔、null 原样保留；
 * - 每个值独立分析，禁止跨字段匹配，值内沿用当前优先级与重叠裁决；
 * - 结果以格式化 JSON 展示，命中解释按 RFC 6901 Pointer 分组。
 */
export function analyzeJson(text: string, rules: Rule[]): JsonAnalysis {
  hitSeq = 0;

  const failed = (err: unknown, pos: number): JsonAnalysis => {
    const { line, col } = posToLineCol(text, pos);
    return {
      mode: 'json',
      parseError: {
        message: err instanceof Error ? err.message : String(err),
        line,
        col,
        pos,
      },
      fields: [],
      tree: null,
      output: null,
      errors: [],
      stats: { total: 0, adopted: 0, rejected: 0 },
      coverage: [],
    };
  };

  let root: JsonNode;
  try {
    root = new JsonParser(text).parse();
  } catch (err) {
    return failed(err, err instanceof JsonSyntaxError ? err.pos : 0);
  }

  // 深度优先遍历（对象按键序、数组按下标），为每个字符串值独立做一次分析。
  // 键名只用于生成 Pointer，本身不参与匹配；number/boolean/null 原样保留。
  const fields: JsonField[] = [];
  const errors: RuleError[] = [];
  const seenErrors = new Set<string>();
  const coverage: CoverageItem[] = [];
  let total = 0;
  let adopted = 0;
  let rejected = 0;
  let fieldSeq = 0;

  const analyzeStringNode = (node: JsonStringNode, pointer: string): JsonField => {
    const fid = `jf-${fieldSeq++}`;
    const { line, col } = posToLineCol(text, node.quoteStart);
    const a = runAnalysis(node.value, rules);
    for (const h of a.hits) h.pointer = pointer;
    for (const c of a.coverage) {
      c.pointer = pointer;
      c.fid = fid;
      // 同一字段下可能有多个候选；带上字段 id 与值内坐标后即可唯一
      c.covKey = `${fid}-cov-${c.start}-${c.end}`;
    }
    for (const e of a.errors) {
      const dedupeKey = `${e.ruleId}:${e.message}`;
      if (!seenErrors.has(dedupeKey)) {
        seenErrors.add(dedupeKey);
        errors.push(e);
      }
    }
    total += a.stats.total;
    adopted += a.stats.adopted;
    rejected += a.stats.rejected;
    coverage.push(...a.coverage);
    const field: JsonField = { fid, pointer, value: node.value, line, col, analysis: a };
    fields.push(field);
    return field;
  };

  // 同步构建界面渲染树
  const buildView = (node: JsonNode, pointer: string, keyToken?: string): JsonViewNode => {
    switch (node.type) {
      case 'object': {
        const children = (node.members ?? []).map((member) => {
          const childPointer = `${pointer}/${escapeJsonPointerToken(member.key.value)}`;
          return buildView(member.value, childPointer, text.slice(member.key.start, member.key.end));
        });
        return { kind: 'object', pointer, raw: '', keyToken, children };
      }
      case 'array': {
        const children = (node.elements ?? []).map((el, idx) =>
          buildView(el, `${pointer}/${idx}`),
        );
        return { kind: 'array', pointer, raw: '', keyToken, children };
      }
      case 'string': {
        const strNode = node as JsonStringNode;
        // 重复键（合法 JSON）会得到相同 Pointer，因此每个字符串节点独立分析、不做缓存
        const field = analyzeStringNode(strNode, pointer);
        return { kind: 'string', pointer, raw: '', keyToken, field };
      }
      case 'number':
        return { kind: 'number', pointer, raw: text.slice(node.start, node.end), keyToken };
      case 'boolean':
        return { kind: 'boolean', pointer, raw: (node.value as boolean) ? 'true' : 'false', keyToken };
      case 'null':
        return { kind: 'null', pointer, raw: 'null', keyToken };
    }
  };

  const tree = buildView(root, '');

  // 用脱敏后的值替换字符串节点，其余节点使用原文切片，格式化输出（2 空格缩进）
  const renderView = (vn: JsonViewNode, depth: number): string => {
    const pad = '  '.repeat(depth + 1);
    const closePad = '  '.repeat(depth);
    switch (vn.kind) {
      case 'string':
        return JSON.stringify(vn.field?.analysis.output ?? '');
      case 'number':
      case 'boolean':
      case 'null':
        return vn.raw;
      case 'object': {
        const children = vn.children ?? [];
        if (children.length === 0) return '{}';
        const lines = children.map(
          (child) => `${pad}${child.keyToken}: ${renderView(child, depth + 1)}`,
        );
        return `{\n${lines.join(',\n')}\n${closePad}}`;
      }
      case 'array': {
        const children = vn.children ?? [];
        if (children.length === 0) return '[]';
        const lines = children.map((child) => `${pad}${renderView(child, depth + 1)}`);
        return `[\n${lines.join(',\n')}\n${closePad}]`;
      }
    }
  };

  return {
    mode: 'json',
    parseError: null,
    fields,
    tree,
    output: renderView(tree, 0),
    errors,
    stats: { total, adopted, rejected },
    coverage,
  };
}
