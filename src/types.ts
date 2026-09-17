/** 规则作用范围：全文 或 逐行匹配（^/$ 行为不同，且命中不能跨行） */
export type RuleScope = 'all' | 'line';

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
