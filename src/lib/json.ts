import type {
  Analysis,
  Hit,
  JsonAnalysis,
  JsonField,
  JsonParseError,
  Rule,
} from '../types';
import { compileRules, runAnalysis } from './engine';

/* ------------------------- RFC 6901 JSON Pointer ------------------------- */

/**
 * 按 RFC 6901 转义 reference token：先转义 `~` 为 `~0`，再转义 `/` 为 `~1`
 * （顺序不可颠倒，否则 `~1` 会被二次转义）。
 */
export function escapePointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** 由路径段拼出 JSON Pointer（数组下标以十进制字符串参与） */
export function formatPointer(path: (string | number)[]): string {
  if (path.length === 0) return '';
  return '/' + path.map((p) => escapePointerToken(String(p))).join('/');
}

/** 序列化为 JSON 字符串字面量的“值内容”（不含两侧引号），如 tab -> \t */
export function escapeJsonString(s: string): string {
  // JSON.stringify 对字符串产出合法的 JSON 字面量，去掉两端引号即可
  return JSON.stringify(s).slice(1, -1);
}

/* ------------------------------ JSON 遍历 ------------------------------ */

/** 文档序收集对象与数组中的全部字符串值；键名与其他标量原样保留 */
interface FieldDesc {
  pointer: string;
  path: (string | number)[];
  value: string;
}

function collectStringFields(
  root: unknown,
  fields: FieldDesc[],
  path: (string | number)[],
): void {
  if (typeof root === 'string') {
    // 递归进入数组元素 / 对象值后若本身为字符串，即为待处理字段
    if (path.length > 0) {
      fields.push({ pointer: formatPointer(path), path, value: root });
    }
  } else if (Array.isArray(root)) {
    root.forEach((item, i) => collectStringFields(item, fields, [...path, i]));
  } else if (root !== null && typeof root === 'object') {
    for (const [key, value] of Object.entries(root as Record<string, unknown>)) {
      const next = [...path, key];
      if (typeof value === 'string') {
        fields.push({ pointer: formatPointer(next), path: next, value });
      } else {
        collectStringFields(value, fields, next);
      }
    }
  }
  // 深层或顶层的 number / boolean / null：不是字符串值，跳过
}

/** 深拷贝 JSON 树，并按 pointer -> 脱敏后字符串 替换叶子值 */
function cloneWithReplacements(
  root: unknown,
  outputs: Map<string, string>,
): unknown {
  const walk = (node: unknown, path: (string | number)[]): unknown => {
    const pointer = formatPointer(path);
    if (typeof node === 'string' && outputs.has(pointer)) {
      return outputs.get(pointer);
    }
    if (Array.isArray(node)) {
      return node.map((item, i) => walk(item, [...path, i]));
    }
    if (node !== null && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        out[key] = walk(value, [...path, key]);
      }
      return out;
    }
    return node;
  };
  return walk(root, []);
}

/* --------------------------- 解析错误行列定位 --------------------------- */

/**
 * 从 JSON.parse 错误中提取行列位置。
 * V8（Chrome/Edge/Node）与 SpiderMonkey（Firefox）的报错均带 `position N`，
 * JavaScriptCore（Safari）部分版本只描述行列，这里做兼容兜底。
 */
export function locateParseError(text: string, message: string): JsonParseError {
  let pos = -1;

  const atPos = message.match(/position\s+(\d+)/i);
  if (atPos) {
    pos = parseInt(atPos[1], 10);
  } else {
    // Safari 风格："Unexpected ... at line 3 column 5"
    const lineMatch = message.match(/line\s+(\d+)/i);
    const colMatch = message.match(/column\s+(\d+)/i);
    if (lineMatch && colMatch) {
      const line = parseInt(lineMatch[1], 10);
      const col = parseInt(colMatch[1], 10);
      pos = posFromLineCol(text, line, col);
    }
  }

  if (pos < 0 || pos > text.length) {
    // 原生错误未携带可用位置（如新版 V8 的 Unexpected token），用自写解析器定位
    pos = findSyntaxErrorPos(text);
  }

  const { line, col } = lineColFromPos(text, pos);
  return { message, line, col, pos };
}

function lineColFromPos(text: string, pos: number): { line: number; col: number } {
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

function posFromLineCol(text: string, line: number, col: number): number {
  let currentLine = 1;
  for (let i = 0; i < text.length; i++) {
    if (currentLine === line) return Math.min(i + col - 1, text.length);
    if (text[i] === '\n') currentLine++;
  }
  return text.length;
}

/**
 * 与 JSON.parse 同语法的轻量递归下降解析器，仅用于在原生报错缺少位置信息时
 * （新版 V8 的 "Unexpected token" 消息不带 position）定位首个语法错误的字符偏移。
 * 合法 JSON 的场景永远不会进入这里（先经 JSON.parse 确认失败）。
 */
function findSyntaxErrorPos(text: string): number {
  let i = 0;
  const n = text.length;

  const skipWs = () => {
    while (i < n && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++;
  };

  const parseString = (): number | null => {
    const start = i;
    i++; // 开头引号
    while (i < n) {
      const ch = text[i];
      if (ch === '"') {
        i++;
        return null;
      }
      if (ch === '\\') {
        i++;
        if (i >= n) return start;
        const esc = text[i];
        if (esc === 'u') {
          for (let k = 1; k <= 4; k++) {
            const p = i + k;
            if (p >= n) return start;
            if (!/[0-9a-fA-F]/.test(text[p])) return p;
          }
          i += 4;
        } else if (!'"\\/bfnrt'.includes(esc)) {
          return i;
        }
        i++;
      } else {
        const code = ch.charCodeAt(0);
        if (code < 0x20) return i;
        i++;
      }
    }
    return start; // 未闭合：指向开头引号
  };

  const parseLiteral = (literal: string): number | null => {
    if (text.startsWith(literal, i)) {
      i += literal.length;
      return null;
    }
    return i;
  };

  const parseNumber = (): number | null => {
    const start = i;
    if (text[i] === '-') i++;
    while (i < n && /[0-9]/.test(text[i])) i++;
    if (i === start || (text[start] === '-' && i === start + 1)) return i;
    // 整数部分零开头校验
    const intStart = text[start] === '-' ? start + 1 : start;
    if (text[intStart] === '0' && /[0-9]/.test(text[intStart + 1] ?? '')) return intStart + 1;
    if (text[i] === '.') {
      i++;
      const frac = i;
      while (i < n && /[0-9]/.test(text[i])) i++;
      if (i === frac) return i;
    }
    if (text[i] === 'e' || text[i] === 'E') {
      i++;
      if (text[i] === '+' || text[i] === '-') i++;
      const exp = i;
      while (i < n && /[0-9]/.test(text[i])) i++;
      if (i === exp) return i;
    }
    return null;
  };

  const parseValue = (): number | null => {
    skipWs();
    if (i >= n) return i;
    const ch = text[i];
    if (ch === '"') return parseString();
    if (ch === '{') return parseObject();
    if (ch === '[') return parseArray();
    if (ch === 't') return parseLiteral('true');
    if (ch === 'f') return parseLiteral('false');
    if (ch === 'n') return parseLiteral('null');
    if (ch === '-' || /[0-9]/.test(ch)) return parseNumber();
    return i;
  };

  const parseObject = (): number | null => {
    i++; // {
    skipWs();
    if (text[i] === '}') {
      i++;
      return null;
    }
    for (;;) {
      skipWs();
      if (text[i] !== '"') return i;
      const err = parseString();
      if (err !== null) return err;
      skipWs();
      if (text[i] !== ':') return i;
      i++;
      const verr = parseValue();
      if (verr !== null) return verr;
      skipWs();
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === '}') {
        i++;
        return null;
      }
      return i;
    }
  };

  const parseArray = (): number | null => {
    i++; // [
    skipWs();
    if (text[i] === ']') {
      i++;
      return null;
    }
    for (;;) {
      const err = parseValue();
      if (err !== null) return err;
      skipWs();
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === ']') {
        i++;
        return null;
      }
      return i;
    }
  };

  skipWs();
  const err = parseValue();
  if (err !== null) return err;
  skipWs();
  // 原生解析失败但自写解析器走完：保险起见报首个尾随字符
  return i < n ? i : Math.min(n, n - 1);
}

/* ------------------------------ 主分析入口 ------------------------------ */

/**
 * JSON 结构化模式：
 * 1. 解析原文为 JSON，失败则返回 parseError 且不产出任何脱敏结果；
 * 2. 仅对对象与数组中的字符串值分别运行现有规则——字段间互不可见，
 *    禁止跨字段匹配，单字段内部沿用既有优先级与重叠裁决；
 * 3. 键名、数字、布尔值、null 原样保留，重建后格式化输出。
 */
export function analyzeJson(text: string, rules: Rule[]): JsonAnalysis {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return {
      data: null,
      masked: null,
      output: '',
      fields: [],
      hits: [],
      coverage: [],
      errors: [],
      parseError: locateParseError(
        text,
        err instanceof Error ? err.message : String(err),
      ),
      stats: { total: 0, adopted: 0, rejected: 0 },
    };
  }

  const { compiled, errors } = compileRules(rules);

  // 顶层字符串：没有容器，但仍是一个字符串值，按唯一空指针字段处理；
  // 其余标量（number/boolean/null）不含任何字符串字段，原样通过。
  const descs: FieldDesc[] =
    typeof data === 'string'
      ? [{ pointer: '', path: [], value: data }]
      : (() => {
          const list: FieldDesc[] = [];
          collectStringFields(data, list, []);
          return list;
        })();

  const outputs = new Map<string, string>();
  const fields: JsonField[] = [];
  const hits: Hit[] = [];
  const coverage = [];

  for (const desc of descs) {
    const analysis = runAnalysis(desc.value, compiled, []);
    fields.push({ ...desc, analysis });
    outputs.set(desc.pointer, analysis.output);
    for (const h of analysis.hits) {
      hits.push({ ...h, pointer: desc.pointer });
    }
    for (const c of analysis.coverage) {
      coverage.push({ ...c, pointer: desc.pointer });
    }
  }

  const masked = cloneWithReplacements(data, outputs);
  const adoptedCount = hits.filter((h) => h.adopted).length;

  return {
    data,
    masked,
    output: JSON.stringify(masked, null, 2),
    fields,
    hits,
    coverage,
    errors,
    parseError: null,
    stats: {
      total: hits.length,
      adopted: adoptedCount,
      rejected: hits.length - adoptedCount,
    },
  };
}

/**
 * 把 JSON 模式的结果整理成与纯文本 Analysis 同形状的对象，
 * 供「规则面板」等按规则维度统计命中数的组件复用。
 * segments/output 在 JSON 模式下不被这些组件使用，置空即可。
 */
export function jsonAnalysisToAnalysis(json: JsonAnalysis): Analysis {
  return {
    hits: json.hits,
    segments: [],
    output: json.output,
    errors: json.errors,
    coverage: json.coverage,
    stats: json.stats,
  };
}
