/** 规则作用范围：全文 或 逐行匹配（^/$ 行为不同，且命中不能跨行） */
export type RuleScope = 'all' | 'line';

/** 样例解析模式：纯文本 或 JSON 结构化（仅处理对象/数组中的字符串值） */
export type SampleMode = 'text' | 'json';

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  /** 正则表达式源码（不含两侧斜杠与标志） */
  pattern: string;
  /** 正则标志，g 由引擎强制开启 */
  flags: string;
  /** 替换模板，支持 $1..$99 捕获组、$& 整段命中、$$ 字面量 */
  template: string;
  scope: RuleScope;
  /** 展示用颜色 */
  color: string;
}

export interface Sample {
  id: string;
  name: string;
  text: string;
  /** 解析模式；旧数据缺省时视为纯文本 */
  mode?: SampleMode;
}

export interface PersistState {
  rules: Rule[];
  samples: Sample[];
  currentSampleId: string | null;
}

export interface RuleError {
  ruleId: string;
  message: string;
}

/** 单条规则在原文上的一次命中 */
export interface Hit {
  id: string;
  ruleId: string;
  ruleName: string;
  color: string;
  /** 规则列表序号（从 1 开始），数值越小优先级越高 */
  priority: number;
  start: number;
  end: number;
  text: string;
  groups: string[];
  replacement: string;
  adopted: boolean;
  /** 被舍弃时的解释 */
  rejectedReason?: string;
  /** JSON 模式下命中所属字段的 RFC 6901 JSON Pointer（纯文本模式无此字段） */
  pointer?: string;
}

/** 一次性替换后生成的结果片段：未命中区域或被采用的命中 */
export interface Segment {
  start: number;
  end: number;
  kind: 'plain' | 'replacement';
  text: string;
  hitId?: string;
}

export type SensitiveKind = 'email' | 'phone' | 'idcard';

export interface CoverageItem {
  kind: SensitiveKind;
  start: number;
  end: number;
  text: string;
  /** 身份证末位校验是否通过（仅身份证） */
  checksumOk?: boolean;
  /** JSON 模式下候选所属字段的 RFC 6901 JSON Pointer（纯文本模式无此字段） */
  pointer?: string;
}

export interface Analysis {
  hits: Hit[];
  segments: Segment[];
  output: string;
  errors: RuleError[];
  coverage: CoverageItem[];
  stats: {
    total: number;
    adopted: number;
    rejected: number;
  };
}

/** JSON 模式：一个字符串字段（对象值或数组元素）的分析结果 */
export interface JsonField {
  /** RFC 6901 JSON Pointer */
  pointer: string;
  /** 字段路径（未转义），供展示使用 */
  path: (string | number)[];
  /** 该字段的原始字符串值 */
  value: string;
  analysis: Analysis;
}

/** JSON.parse 失败时的错误定位（行列均 1 起始） */
export interface JsonParseError {
  message: string;
  line: number;
  col: number;
  pos: number;
}

export interface JsonAnalysis {
  /** 解析后的原始 JSON 树；解析失败时为 null */
  data: unknown;
  /** 脱敏并重建后的 JSON 树；解析失败时为 null */
  masked: unknown;
  /** 格式化（2 空格缩进）的脱敏结果 JSON 文本；解析失败时为空串 */
  output: string;
  fields: JsonField[];
  /** 全部字段上的命中汇总（ID 全局唯一，禁止跨字段重叠） */
  hits: Hit[];
  coverage: CoverageItem[];
  errors: RuleError[];
  parseError: JsonParseError | null;
  stats: {
    total: number;
    adopted: number;
    rejected: number;
  };
}
