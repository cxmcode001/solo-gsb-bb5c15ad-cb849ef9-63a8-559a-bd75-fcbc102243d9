/** 规则作用范围：全文 或 逐行匹配（^/$ 行为不同，且命中不能跨行） */
export type RuleScope = 'all' | 'line';

/** 样例解析模式：纯文本（旧配置默认）或 JSON 结构化 */
export type SampleMode = 'text' | 'json';

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  /** 正则表达式源码（不含两侧斜杠与标志） */
  pattern: string;
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
  /** 解析模式；旧数据中缺省，一律按 text 处理 */
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

/** 单条规则在原文（或单个 JSON 字符串值）上的一次命中 */
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
  /** JSON 结构化模式下命中所属值的 RFC 6901 JSON Pointer */
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
  /** JSON 结构化模式下候选所属值的 JSON Pointer */
  pointer?: string;
  /** JSON 结构化模式下所属字段的唯一标识（重复键 Pointer 相同） */
  fid?: string;
  /** 联动高亮 key；缺省时由 start/end 合成（纯文本模式） */
  covKey?: string;
}

export interface AnalysisStats {
  total: number;
  adopted: number;
  rejected: number;
}

export interface Analysis {
  hits: Hit[];
  segments: Segment[];
  output: string;
  errors: RuleError[];
  coverage: CoverageItem[];
  stats: AnalysisStats;
}

/* ============================ JSON 结构化模式 ============================ */

/** JSON 树中的一个字符串值节点 */
export interface JsonField {
  /** 字段唯一标识（重复键的 Pointer 相同，id 不同） */
  fid: string;
  /** RFC 6901 JSON Pointer（根为 ""，根字符串为 ""） */
  pointer: string;
  /** 解码后的字符串值（未脱敏） */
  value: string;
  /** 在原文中的 1 起始行/列（值起始，指向开引号） */
  line: number;
  col: number;
  /** 命中分析结果（坐标相对于 value 内部） */
  analysis: Analysis;
}

/** JSON 解析失败信息（行列指向原文，1 起始） */
export interface JsonParseError {
  message: string;
  line: number;
  col: number;
  pos: number;
}

export interface JsonAnalysis {
  mode: 'json';
  parseError: JsonParseError | null;
  /** 按深度优先（对象键序 / 数组下标）排列的全部字符串值 */
  fields: JsonField[];
  /** 供界面渲染的语法树（键名/数字/布尔/null 均为原文切片） */
  tree: JsonViewNode | null;
  /** 脱敏后的 JSON（格式化输出）；解析失败时为 null */
  output: string | null;
  /** 按规则去重后的错误 */
  errors: RuleError[];
  stats: AnalysisStats;
  coverage: CoverageItem[];
}

/** JSON 模式界面渲染用的语法树节点 */
export interface JsonViewNode {
  kind: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  /** RFC 6901 JSON Pointer */
  pointer: string;
  /** 原文切片：键 token（含引号，仅对象子节点）/ 数字 / 布尔 / null */
  raw: string;
  /** 对象成员的键 token（含引号、原样转义） */
  keyToken?: string;
  children?: JsonViewNode[];
  /** 字符串节点对应的字段分析 */
  field?: JsonField;
}

export interface TextAnalysis extends Analysis {
  mode: 'text';
}

/** 样例的完整分析结果：纯文本或 JSON 结构化 */
export type SampleAnalysis = TextAnalysis | JsonAnalysis;
