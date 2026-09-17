import type { PersistState, Rule, Sample } from '../types';

const STORAGE_KEY = 'mask-rule-bench:v1';

export function uid(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function defaultRules(): Rule[] {
  return [
    {
      id: uid('rule'),
      name: '联系方式行整行打码（演示更高优先级覆盖）',
      enabled: true,
      pattern: '^联系方式：.*$',
      flags: 'gm',
      template: '联系方式：【已隐藏】',
      scope: 'line',
      color: '#dc2626',
    },
    {
      id: uid('rule'),
      name: '身份证号（保留前6后4）',
      enabled: true,
      pattern: '\\b(\\d{6})\\d{8}(\\d{4})\\b',
      flags: 'g',
      template: '$1********$2',
      scope: 'all',
      color: '#2563eb',
    },
    {
      id: uid('rule'),
      name: '邮箱（保留首字母与域名）',
      enabled: true,
      pattern: '([A-Za-z0-9])[A-Za-z0-9._%+-]*(@(?:gmail|company)\\.com)',
      flags: 'g',
      template: '$1****$2',
      scope: 'all',
      color: '#059669',
    },
    {
      id: uid('rule'),
      name: '手机号（保留前3后2）',
      enabled: true,
      pattern: '(?<!\\d)(1[3-8]\\d)\\d{6}(\\d{2})(?!\\d)',
      flags: 'g',
      template: '$1******$2',
      scope: 'all',
      color: '#d97706',
    },
  ];
}

export function defaultSamples(): Sample[] {
  return [
    {
      id: uid('sample'),
      name: '客服工单（含重叠裁决演示）',
      mode: 'text',
      text: `客户：张伟，身份证 110101199003071233，手机号 13800138000。
备用手机 15912345678，邮箱 zhang.wei@company.com。
联系方式：电话 18666668888 / 邮箱 zhangwei@gmail.com
备注：手机号样式 19900001111 未被「手机号」规则命中（号段过新），但被检测器提示；
可疑身份证 110101199013071234（月份非法，检测器不认）仍被纯数字规则误替换；
临时联络 old.li@internal.io 不在邮箱域名白名单规则内。`,
    },
    {
      id: uid('sample'),
      name: '客户资料 JSON（结构化模式）',
      mode: 'json',
      text: `{
  "customer": {
    "name": "张伟",
    "idCard": "110101199003071233",
    "contacts": [
      { "type": "手机", "value": "13800138000" },
      { "type": "邮箱", "value": "zhang.wei@company.com" }
    ],
    "address": {
      "city": "北京",
      "detail": "朝阳区 联系方式：18666668888"
    }
  },
  "meta": {
    "level": 3,
    "vip": true,
    "note": null
  },
  "a/b~c": "键名中的 ~ 与 / 不参与匹配，邮箱 li.si@gmail.com 在值中会被脱敏",
  "idCardType": "idCard 这个键名里的 110101199003071233 不会被扫描"
}`,
    },
    {
      id: uid('sample'),
      name: '空白样例',
      mode: 'text',
      text: '',
    },
  ];
}

export function defaultState(): PersistState {
  const samples = defaultSamples();
  return {
    rules: defaultRules(),
    samples,
    currentSampleId: samples[0].id,
  };
}

export function loadState(): PersistState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<PersistState>;
    if (!Array.isArray(parsed.rules) || !Array.isArray(parsed.samples)) return defaultState();
    return {
      rules: parsed.rules,
      // 旧配置（无 mode 字段）一律视为纯文本；非法值回退为纯文本
      samples: parsed.samples.map((s) => ({ ...s, mode: s.mode === 'json' ? 'json' : 'text' })),
      currentSampleId: parsed.currentSampleId ?? null,
    };
  } catch {
    return defaultState();
  }
}

export function saveState(state: PersistState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 隐私模式或配额超限时静默失败
  }
}

export function exportJson(state: PersistState): void {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.href = url;
  a.download = `mask-rules-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function parseImport(text: string): PersistState | { error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { error: `JSON 解析失败：${err instanceof Error ? err.message : String(err)}` };
  }
  const obj = data as Partial<PersistState>;
  if (!obj || typeof obj !== 'object') return { error: '文件内容不是有效的对象' };
  if (!Array.isArray(obj.rules)) return { error: '缺少 rules 数组' };
  if (!Array.isArray(obj.samples)) return { error: '缺少 samples 数组' };
  for (const r of obj.rules) {
    if (
      typeof r.id !== 'string' ||
      typeof r.name !== 'string' ||
      typeof r.pattern !== 'string' ||
      typeof r.template !== 'string'
    ) {
      return { error: 'rules 中存在结构不完整的规则' };
    }
  }
  for (const s of obj.samples) {
    if (typeof s.id !== 'string' || typeof s.name !== 'string' || typeof s.text !== 'string') {
      return { error: 'samples 中存在结构不完整的样例' };
    }
  }
  return {
    rules: obj.rules as Rule[],
    // 旧文件缺少 mode：默认纯文本；仅接受明确的 'json'
    samples: (obj.samples as Sample[]).map((s) => ({
      ...s,
      mode: s.mode === 'json' ? 'json' : 'text',
    })),
    currentSampleId:
      typeof obj.currentSampleId === 'string' &&
      (obj.samples as Sample[]).some((s) => s.id === obj.currentSampleId)
        ? obj.currentSampleId
        : (obj.samples as Sample[])[0]?.id ?? null,
  };
}
