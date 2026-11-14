#!/usr/bin/env node
// 用途：把 L1 合法合规判据底稿编译成模块内的 TS 常量，并校验底稿、官方原文快照、文件表与产物一致。
// 调用方：dev 脚本的 lint criteria 子项、tools/generate-review-criteria.test.mjs。
// 边界：只读仓库内文件，不联网；--check 不写盘，任一条断言失败即退出 1。
// 依据：docs/research/criteria/README.md；docs/handoff-l1.md。

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CRITERIA_DIR = 'docs/research/criteria';
const DOCUMENTS_FILE = 'backend/geo-dict/src/reference-data/reference-data.generated.ts';
const PRODUCT_BY_MODULE = {
  deadline: 'backend/deadline/src/criteria.generated.ts',
  case: 'backend/case/src/criteria.generated.ts',
};
const INTERPRETATIONS = ['直译', '推导', '裁量'];
const STATUSES = ['active', 'objected', 'superseded'];
// 原文中文日数与期望 dayCount 的对应。只用于直译条目的交叉校验。
const CN_DAY_TO_COUNT = new Map([
  ['九十日', 90],
  ['三十日', 30],
  ['五日', 5],
  ['三日', 3],
]);

// 去掉全部空白。摘录与原文的比对只做空白归一化，不做标点归一化。
function normalize(text) {
  return String(text).replace(/\s+/gu, '');
}

// 取 Markdown 内 ```json <tag> 代码块的内容。找不到返回 null。
function parseFenced(text, tag) {
  const pattern = new RegExp('```json\\s+' + tag + '\\s*\\n([\\s\\S]*?)\\n```');
  const matched = pattern.exec(text);
  return matched ? matched[1] : null;
}

// 条号拆成若干可定位片段：去掉括号注与「第 N 款」后按顿号/逗号切分。
function articleParts(article) {
  return String(article)
    .replace(/[（(][^）)]*[）)]/gu, '')
    .replace(/第[一二三四五六七八九十百]+款$/u, '')
    .replace(/末款$/u, '')
    .split(/[、,，]/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

// 读文件；不存在返回 null。
function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

// 从生成的文件表常量里解析文件编号、名称、效力层级与效力状态。
export function parseDocuments(text) {
  const documents = new Map();
  const pattern = /\{ code: "(doc_\d+)", name: "([^"]*)", hierarchyLevel: "([^"]*)", validityStatus: "([^"]*)"/gu;
  for (const matched of text.matchAll(pattern)) {
    documents.set(matched[1], {
      code: matched[1],
      name: matched[2],
      hierarchyLevel: matched[3],
      validityStatus: matched[4],
    });
  }
  return documents;
}

// 读取全部底稿。返回 { drafts, decisions, errors }。
export function loadDrafts(root) {
  const dir = join(root, CRITERIA_DIR);
  const errors = [];
  const drafts = [];
  const decisions = [];
  if (!existsSync(dir)) {
    errors.push(`[结构] 判据底稿目录不在场：${CRITERIA_DIR}`);
    return { drafts, decisions, errors };
  }
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.md') || name === 'README.md') continue;
    const path = `${CRITERIA_DIR}/${name}`;
    const text = readFileSync(join(dir, name), 'utf8');
    const criteriaBlock = parseFenced(text, 'criteria');
    const decisionsBlock = parseFenced(text, 'decisions');
    if (!criteriaBlock && !decisionsBlock) {
      errors.push(`[结构] ${path} 既没有 criteria 代码块，也没有 decisions 代码块`);
      continue;
    }
    try {
      if (criteriaBlock) {
        const parsed = JSON.parse(criteriaBlock);
        drafts.push({ path, document: parsed.document, items: parsed.items ?? [] });
      }
      if (decisionsBlock) {
        const parsed = JSON.parse(decisionsBlock);
        decisions.push(...(parsed.decisions ?? []));
      }
    } catch (error) {
      errors.push(`[结构] ${path} 的 JSON 无法解析：${error.message}`);
    }
  }
  return { drafts, decisions, errors };
}

// 校验一份底稿的法规级元数据。返回错误列表。
function validateDocument(draft, documents, sources, today) {
  const errors = [];
  const { document, path } = draft;
  if (!document || typeof document !== 'object') return [`[结构] ${path} 缺少 document`];
  for (const key of ['code', 'name', 'effectiveOn', 'region', 'hierarchyLevel', 'sourceType', 'snapshot', 'sha256']) {
    if (!document[key]) errors.push(`[结构] ${path} 的 document.${key} 为空`);
  }
  if (!/^doc_\d+$/u.test(document.code ?? '')) {
    errors.push(`[结构] ${path} 的文件编号不是 doc_NNN：${document.code}`);
  }
  if (!Array.isArray(document.officialSources) || document.officialSources.length < 2) {
    errors.push(`[结构] ${path} 的官方来源少于 2 个`);
  }
  if (errors.length > 0) return errors;

  // 断言 1：原文快照在场，sha256 相符。
  const snapshot = sources.get(document.snapshot);
  if (snapshot === null || snapshot === undefined) {
    errors.push(`[断言 1] ${path} 的原文快照不在场：${document.snapshot}`);
  } else {
    const actual = createHash('sha256').update(snapshot).digest('hex');
    if (actual !== document.sha256) {
      errors.push(`[断言 1] ${path} 的原文哈希不符：底稿 ${document.sha256}，实际 ${actual}`);
    }
  }

  // 断言 4：文件编号命中文件表，效力状态非已废止；存疑须写接受理由。
  const row = documents.get(document.code);
  if (!row) {
    errors.push(`[断言 4] ${path} 的文件编号不在文件表：${document.code}`);
  } else {
    if (row.hierarchyLevel !== document.hierarchyLevel) {
      errors.push(`[断言 4] ${path} 的效力层级与文件表不符：底稿 ${document.hierarchyLevel}，文件表 ${row.hierarchyLevel}`);
    }
    if (row.validityStatus === '已废止') {
      errors.push(`[断言 4] ${path} 引用了已废止文件：${document.code}`);
    }
    if (row.validityStatus === '存疑' && !document.acknowledgedDoubtful) {
      errors.push(`[断言 4] ${path} 引用了存疑文件 ${document.code}，须在 document.acknowledgedDoubtful 写接受理由`);
    }
  }

  // 断言 5：施行日不晚于今日，或标明尚未施行。
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(document.effectiveOn)) {
    errors.push(`[断言 5] ${path} 的施行日不是 YYYY-MM-DD：${document.effectiveOn}`);
  } else if (document.effectiveOn > today && !document.notYetEffective) {
    errors.push(`[断言 5] ${path} 的施行日晚于今日：${document.effectiveOn}`);
  }
  return errors;
}

// 校验消费方：路径在场且符号出现在文件正文中。
function validateConsumer(consumer, where, root, errors) {
  const split = String(consumer).split('#');
  if (split.length !== 2) return;
  const rel = split[0];
  const symbol = split[1];
  const absolute = join(root, rel);
  if (!existsSync(absolute)) {
    errors.push(`[结构] ${where} 的消费方文件不在场：${rel}`);
    return;
  }
  const text = readFileSync(absolute, 'utf8');
  if (!text.includes(symbol)) {
    errors.push(`[结构] ${where} 的消费方符号不在文件内：${symbol}（${rel}）`);
  }
}

// 推导父项与期望值的工作日口径是否一致（CRIT-DL-004 型：五日 + 工作日 → dayCount 5 dayBasis working）。
function validateDerivationShape(item, draft, where, errors) {
  if (item.interpretation !== '推导' || !item.expected) return;
  const parents = (item.derivation ?? [])
    .map((ref) => draft.items.find((row) => row.id === ref))
    .filter((row) => row);
  if (parents.length === 0) return;
  const periodParent = parents.find((row) => row.expected?.period);
  const unitParent = parents.find((row) => row.expected?.unit === '工作日');
  if (periodParent?.expected?.period === '五日' && unitParent) {
    if (item.expected.dayCount !== 5 || item.expected.dayBasis !== 'working') {
      errors.push(`[结构] ${where} 的推导结果与父项五日/工作日不一致`);
    }
  }
}

// 校验单条判据项。draftIds 是本底稿全部判据编号。
function validateItem(item, draft, snapshot, draftIds, today, root) {
  const errors = [];
  const where = `${draft.path} ${item.id ?? '(缺 id)'}`;
  for (const key of ['id', 'article', 'interpretation', 'status']) {
    if (!item[key]) errors.push(`[结构] ${where} 缺少 ${key}`);
  }
  if (item.id && !/^CRIT-[A-Z0-9-]+$/u.test(item.id)) {
    errors.push(`[结构] ${where} 的编号格式不是 CRIT-<域>-<序号>`);
  }
  if (item.interpretation && !INTERPRETATIONS.includes(item.interpretation)) {
    errors.push(`[结构] ${where} 的解释类型不在三分层内：${item.interpretation}`);
  }
  if (item.status && !STATUSES.includes(item.status)) {
    errors.push(`[结构] ${where} 的状态不在枚举内：${item.status}`);
  }
  if (!Array.isArray(item.consumers)) {
    errors.push(`[结构] ${where} 的 consumers 必须是数组`);
  } else {
    for (const consumer of item.consumers) {
      if (!/^backend\/[a-z-]+\/.*#.+$/u.test(consumer)) {
        errors.push(`[结构] ${where} 的消费方格式不是 仓库路径#符号：${consumer}`);
      }
    }
  }
  if (!snapshot) return errors;

  // 断言 2：摘录是原文的逐字连续子串。
  if (item.excerpt) {
    if (!normalize(snapshot).includes(normalize(item.excerpt))) {
      errors.push(`[断言 2] ${where} 的摘录不是原文的逐字连续子串`);
    }
  } else if (item.interpretation !== '推导' && item.interpretation !== '裁量') {
    errors.push(`[断言 2] ${where} 缺少原文摘录`);
  }

  // 断言 3：条号能在原文中定位。
  const flat = normalize(snapshot);
  for (const part of articleParts(item.article ?? '')) {
    if (!flat.includes(normalize(part))) {
      errors.push(`[断言 3] ${where} 的条号无法在原文中定位：${part}`);
    }
  }

  // 断言 6：裁量型不得带期望值，且须登记风险。
  if (item.interpretation === '裁量') {
    if (item.expected !== undefined && item.expected !== null) {
      errors.push(`[断言 6] ${where} 是裁量型，不得带期望值`);
    }
    if (!item.riskNote) errors.push(`[断言 6] ${where} 是裁量型，缺少 riskNote`);
  }

  // 断言 7：推导型必须有推导链，引用的判据编号都在同一底稿内。
  if (item.interpretation === '推导') {
    if (!Array.isArray(item.derivation) || item.derivation.length === 0) {
      errors.push(`[断言 7] ${where} 是推导型，缺少推导链`);
    } else {
      for (const ref of item.derivation) {
        if (!draftIds.has(ref)) errors.push(`[断言 7] ${where} 的推导链引用了本底稿之外的判据：${ref}`);
      }
    }
  }

  // 直译：期望值与原文取值都必须在场，取值须是摘录的子串。
  if (item.interpretation === '直译') {
    if (!item.expected) errors.push(`[结构] ${where} 是直译型，缺少期望值`);
    if (!item.sourceValues || Object.keys(item.sourceValues).length === 0) {
      errors.push(`[结构] ${where} 是直译型，缺少 sourceValues`);
    } else if (item.expected) {
      for (const [key, value] of Object.entries(item.sourceValues)) {
        if (!(key in item.expected)) {
          errors.push(`[结构] ${where} 的 sourceValues.${key} 在期望值里没有对应键`);
        }
        if (!normalize(item.excerpt ?? '').includes(normalize(value))) {
          errors.push(`[结构] ${where} 的 sourceValues.${key} 不是摘录的子串：${value}`);
        }
        for (const [cn, count] of CN_DAY_TO_COUNT) {
          if (!String(value).includes(cn)) continue;
          const expectedNumber = item.expected[key];
          if (typeof expectedNumber === 'number' && expectedNumber !== count) {
            errors.push(`[结构] ${where} 的 sourceValues.${key} 含「${cn}」但 expected.${key} 不是 ${count}`);
          }
        }
      }
    }
  }

  // 推导型必须有期望值。
  if (item.interpretation === '推导' && !item.expected) {
    errors.push(`[结构] ${where} 是推导型，缺少期望值`);
  }
  if (item.interpretation === '推导') {
    validateDerivationShape(item, draft, where, errors);
    if (typeof item.expected?.dayCount === 'number' || item.expected?.dayBasis) {
      for (const ref of item.derivation ?? []) {
        if (!draftIds.has(ref)) {
          errors.push(`[结构] ${where} 的推导父项 ${ref} 不在本底稿内`);
        }
      }
    }
  }

  for (const consumer of item.consumers ?? []) {
    validateConsumer(consumer, where, root, errors);
  }

  // 施行日与今日的关系由文档级断言 5 兜住，条目级只登记尚未施行。
  if (today && item.notYetEffective && !item.note) {
    errors.push(`[结构] ${where} 标明尚未施行，但缺少 note`);
  }
  return errors;
}

// 校验全部底稿与决策。today 是 YYYY-MM-DD。
export function validate(drafts, decisions, documents, sources, today, root = DEFAULT_ROOT) {
  const errors = [];
  const allIds = new Set();
  for (const draft of drafts) {
    for (const item of draft.items) {
      if (!item.id) continue;
      if (allIds.has(item.id)) errors.push(`[结构] 判据编号重复：${item.id}`);
      allIds.add(item.id);
    }
  }
  for (const draft of drafts) {
    const snapshot = sources.get(draft.document?.snapshot);
    errors.push(...validateDocument(draft, documents, sources, today));
    const draftIds = new Set(draft.items.map((item) => item.id));
    for (const item of draft.items) {
      errors.push(...validateItem(item, draft, snapshot, draftIds, today, root));
    }
  }

  // 决策登记：编号唯一，字段非空，消费方格式正确。
  const decisionIds = new Set();
  for (const decision of decisions) {
    if (!/^DEC-\d+$/u.test(decision.id ?? '')) {
      errors.push(`[结构] 业务决策编号格式不是 DEC-<序号>：${decision.id}`);
      continue;
    }
    if (decisionIds.has(decision.id)) errors.push(`[结构] 业务决策编号重复：${decision.id}`);
    decisionIds.add(decision.id);
    for (const key of ['subject', 'consumer', 'source', 'reason', 'risk']) {
      if (!decision[key]) errors.push(`[结构] 业务决策 ${decision.id} 缺少 ${key}`);
    }
    if (decision.consumer && !/^backend\/[a-z-]+\/.*#.+$/u.test(decision.consumer)) {
      errors.push(`[结构] 业务决策 ${decision.id} 的消费方格式不是 仓库路径#符号`);
    }
    if (decision.consumer) {
      validateConsumer(decision.consumer, `业务决策 ${decision.id}`, root, errors);
    }
  }
  return { errors, decisionIds };
}

// 取消费方所属模块；未登记的模块返回 null。
function moduleOfConsumer(consumer) {
  const matched = /^backend\/([a-z-]+)\//u.exec(consumer);
  return matched && PRODUCT_BY_MODULE[matched[1]] ? matched[1] : null;
}

// 按模块归组判据。无消费方的判据随引用它的推导项归组。
export function groupByModule(drafts) {
  const items = drafts.flatMap((draft) => draft.items.map((item) => ({ ...item, document: draft.document.code })));
  const modules = new Map();
  for (const item of items) {
    const set = new Set();
    for (const consumer of item.consumers ?? []) {
      const module = moduleOfConsumer(consumer);
      if (module) set.add(module);
    }
    if (set.size > 0) modules.set(item.id, set);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of items) {
      if (modules.has(item.id)) continue;
      const parents = items.filter((parent) => (parent.derivation ?? []).includes(item.id));
      const inherited = new Set();
      for (const parent of parents) {
        for (const module of modules.get(parent.id) ?? []) inherited.add(module);
      }
      if (inherited.size > 0) {
        modules.set(item.id, inherited);
        changed = true;
      }
    }
  }
  return { items, modules };
}

// 渲染一个模块的产物。产物必须与运行日期无关，否则 --check 每天都会因日期漂移判红。
export function renderProduct(items, decisions) {
  const lines = [];
  lines.push('// 生成文件，勿手工改。底稿：docs/research/criteria/。');
  lines.push('// 用途：L1 合法合规判据的机器形态，供反向校验测试读取期望值。');
  lines.push('');
  lines.push('/** 一条法规判据。 */');
  lines.push('export interface LegalCriterion {');
  lines.push('  readonly id: string;');
  lines.push('  readonly document: string;');
  lines.push('  readonly article: string;');
  lines.push("  readonly interpretation: '直译' | '推导' | '裁量';");
  lines.push('  readonly expected: Readonly<Record<string, unknown>> | null;');
  lines.push('  readonly consumers: readonly string[];');
  lines.push("  readonly status: 'active' | 'objected' | 'superseded';");
  lines.push('}');
  lines.push('');
  lines.push('/** 一条业务决策登记。 */');
  lines.push('export interface BusinessDecision {');
  lines.push('  readonly id: string;');
  lines.push('  readonly subject: string;');
  lines.push('  readonly consumer: string;');
  lines.push('  readonly source: string;');
  lines.push('  readonly reason: string;');
  lines.push('  readonly risk: string;');
  lines.push('  readonly expected: Readonly<Record<string, unknown>> | null;');
  lines.push('}');
  lines.push('');
  lines.push('/** 本模块消费的法规判据，按编号升序。 */');
  lines.push('export const LEGAL_CRITERIA: readonly LegalCriterion[] = [');
  for (const item of [...items].sort((a, b) => a.id.localeCompare(b.id))) {
    const expected = item.expected === undefined ? null : item.expected;
    lines.push(
      `  { id: ${JSON.stringify(item.id)}, document: ${JSON.stringify(item.document)}, article: ${JSON.stringify(item.article)}, ` +
        `interpretation: ${JSON.stringify(item.interpretation)}, expected: ${JSON.stringify(expected)}, ` +
        `consumers: ${JSON.stringify(item.consumers ?? [])}, status: ${JSON.stringify(item.status)} },`,
    );
  }
  lines.push('];');
  lines.push('');
  lines.push('/** 全部业务决策登记，按编号升序。 */');
  lines.push('export const BUSINESS_DECISIONS: readonly BusinessDecision[] = [');
  for (const decision of [...decisions].sort((a, b) => a.id.localeCompare(b.id))) {
    const expected = decision.expected === undefined ? null : decision.expected;
    lines.push(
      `  { id: ${JSON.stringify(decision.id)}, subject: ${JSON.stringify(decision.subject)}, ` +
        `consumer: ${JSON.stringify(decision.consumer)}, source: ${JSON.stringify(decision.source)}, ` +
        `reason: ${JSON.stringify(decision.reason)}, risk: ${JSON.stringify(decision.risk)}, ` +
        `expected: ${JSON.stringify(expected)} },`,
    );
  }
  lines.push('];');
  lines.push('');
  return lines.join('\n');
}

// 构建全部产物。root 是仓库根，today 是 YYYY-MM-DD。
export function build(root, today) {
  const { drafts, decisions, errors: loadErrors } = loadDrafts(root);
  const documentsText = readIfExists(join(root, DOCUMENTS_FILE));
  const documents = documentsText ? parseDocuments(documentsText) : new Map();
  if (!documentsText) loadErrors.push(`[结构] 文件表产物不在场：${DOCUMENTS_FILE}`);
  const sources = new Map();
  for (const draft of drafts) {
    const path = draft.document?.snapshot;
    if (!path) continue;
    sources.set(path, readIfExists(join(root, path)));
  }
  const { errors: validationErrors } = validate(drafts, decisions, documents, sources, today, root);
  const errors = [...loadErrors, ...validationErrors];
  const { items, modules } = groupByModule(drafts);
  for (const item of items) {
    if (!modules.has(item.id)) {
      errors.push(`[结构] 判据未被任何消费方或推导链引用：${item.id}`);
    }
  }
  const products = new Map();
  for (const [module, path] of Object.entries(PRODUCT_BY_MODULE)) {
    const moduleItems = items.filter((item) => (modules.get(item.id) ?? new Set()).has(module));
    products.set(path, renderProduct(moduleItems, decisions));
  }
  return { products, errors, counts: { items: items.length, decisions: decisions.length, documents: drafts.length } };
}

// 打印错误。
function report(errors) {
  for (const error of errors) console.error(error);
}

// 入口。返回退出码。
export function main(argv, rootDefault = DEFAULT_ROOT) {
  let check = false;
  let root = rootDefault;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--check') check = true;
    else if (arg === '--root') {
      index += 1;
      if (index >= argv.length) {
        console.error('--root 缺少目录参数');
        return 2;
      }
      root = resolve(argv[index]);
    } else {
      console.error(`未知参数：${arg}`);
      return 2;
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  const { products, errors, counts } = build(root, today);
  if (errors.length > 0) {
    report(errors);
    console.error(`判据校验失败：${errors.length} 条。`);
    return 1;
  }
  if (check) {
    let failed = false;
    for (const [path, content] of products) {
      const actual = readIfExists(join(root, path));
      if (actual !== content) {
        console.error(`[断言 8] ${path} 与底稿不一致（重跑 node tools/generate-review-criteria.mjs）`);
        failed = true;
      }
    }
    if (failed) {
      console.error('生成物校验失败：底稿与入库产物不一致。');
      return 1;
    }
    console.log('生成物校验通过：入库产物与底稿一致。');
    return 0;
  }
  for (const [path, content] of products) {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, 'utf8');
    console.log(`已生成 ${path}`);
  }
  console.log(
    `数量核对：${JSON.stringify({ documents: counts.documents, items: counts.items, decisions: counts.decisions })}`,
  );
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}