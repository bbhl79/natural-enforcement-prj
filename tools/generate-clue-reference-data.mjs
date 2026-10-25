#!/usr/bin/env node
// 生成线索参照数据与录入要件类型层声明（#210）。
//
// 为什么有生成器：录入要件的类型层有 1018 条声明，逐条手抄必然漂移；参照数据三张表的
// 初值同样来自定稿底稿。四份草案与三张底稿是事实源，本脚本把它们编译成两份可执行产物：
//   1. backend/geo-dict/src/reference-data/reference-data.generated.ts
//      参照数据初值（来源编码、违法类型编码、依据文件、类型依据、辖区对应）。
//      种子按它写库（ADR 0016 只追加）。
//   2. backend/case/src/clue/requirements/type-layer.generated.ts
//      录入要件类型层声明（ADR 0018：代码里的声明式常量）。
//
// 用法：
//   node tools/generate-clue-reference-data.mjs          重写两份产物
//   node tools/generate-clue-reference-data.mjs --check  只校验产物与底稿一致（不一致退出 1）
//
// 事实源（docs/research/ 下）：
//   clue-source-codes.md             线索来源编码表（#24 定稿 30 项）
//   violation-type-codes.md          违法类型编码表（#203 定稿 94 项 + 19 大类）
//   legal-document-table.md          依据文件表（#203 定稿 80 份）
//   jurisdiction-mapping.md          辖区对应（业务方未交付，现为空表）
//   land-violation-requirements.md   土地类类型层草案（#181/#203 回改）
//   mineral-type-requirements.md     矿产类类型层草案（#182/#203 回改）
//   surveying-violation-requirements.md  测绘类类型层草案（#183/#203 回改）
//   planning-violation-requirements.md   规划类类型层草案（#184/#203 回改）
//
// 依赖：只用 Node 内置能力，无第三方包。产物是入库文件，生成后进版本库。

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RESEARCH = join(ROOT, 'docs/research');
const REFERENCE_OUTPUT = join(ROOT, 'backend/geo-dict/src/reference-data/reference-data.generated.ts');
const TYPE_LAYER_OUTPUT = join(ROOT, 'backend/case/src/clue/requirements/type-layer.generated.ts');

/** 读取底稿。 */
function readDoc(name) {
  return readFileSync(join(RESEARCH, name), 'utf8');
}

/** 取表格行：按表头定位，返回去掉首尾竖线的单元格数组（已 trim）。 */
function tableRows(markdown, headerCells) {
  const lines = markdown.split('\n');
  const splitRow = (line) =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim());
  const start = lines.findIndex((line) => {
    if (!line.trim().startsWith('|')) return false;
    const cells = splitRow(line);
    return cells.length === headerCells.length && cells.every((cell, index) => cell === headerCells[index]);
  });
  if (start < 0) throw new Error(`表头未找到：${headerCells.join(' / ')}`);
  const rows = [];
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) {
      if (rows.length > 0) break;
      continue;
    }
    const cells = splitRow(trimmed);
    if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;
    rows.push(cells);
  }
  return rows;
}

/** 空值归一：破折号与空串都算「没有」。 */
function nullable(value) {
  if (value == null) return null;
  const text = value.trim();
  if (text === '' || text === '—' || text === '-' || text === '–') return null;
  return text;
}

// ---- 线索来源编码表（#24 定稿 30 项）----
function readSourceCodes() {
  const rows = tableRows(readDoc('clue-source-codes.md'), ['编码', '名称', '上级编码', '层级']);
  return rows.map(([code, name, parentCode]) => ({
    code,
    name,
    parentCode: nullable(parentCode),
  }));
}

// ---- 违法类型编码表（#203 定稿：94 具体 + 19 大类）----
function readViolationTypes() {
  const markdown = readDoc('violation-type-codes.md');
  const specific = tableRows(markdown, ['编码', '名称', '法域', '上级大类编码', '附录序号出处']).map(
    ([code, name, domain, parentCode, appendix]) => ({
      code,
      name,
      domain,
      parentCode: nullable(parentCode),
      selectable: true,
      appendix: nullable(appendix),
    }),
  );
  const categories = tableRows(markdown, ['编码', '名称', '法域', '附录序号出处']).map(
    ([code, name, domain, appendix]) => ({
      code,
      name,
      domain,
      parentCode: null,
      selectable: false,
      appendix: nullable(appendix),
    }),
  );
  return [...specific, ...categories];
}

// ---- 依据文件表（#203 定稿 80 份）----
function readDocuments() {
  const rows = tableRows(readDoc('legal-document-table.md'), [
    '文件编号',
    '名称',
    '效力层级',
    '效力状态',
    '引用次数',
    '说明',
  ]);
  return rows.map(([code, name, hierarchyLevel, validityStatus, , note]) => ({
    code,
    name,
    hierarchyLevel,
    validityStatus,
    note: nullable(note),
  }));
}

// ---- 辖区对应（业务方未交付，现为空表）----
function readJurisdiction() {
  const rows = tableRows(readDoc('jurisdiction-mapping.md'), [
    '街道（镇）编码',
    '街道（镇）名称',
    '机构编码',
    '机构名称',
  ]);
  return rows.map(([code, name, orgCode, orgName]) => ({ code, name, orgCode, orgName }));
}

// ---- 规划类分派指导（#207 P7）----
function readDispatchGuidance() {
  const rows = tableRows(readDoc('planning-dispatch-guidance.md'), [
    '类型编码',
    '分派指导',
    '附录出处',
  ]);
  return rows.map(([typeCode, guidance]) => ({ typeCode, guidance }));
}

// ---- 类型层草案（#181–#184，经 #192/#193/#195/#197/#198/#199 回改）----
const REQUIREMENT_DRAFTS = [
  'land-violation-requirements.md',
  'mineral-type-requirements.md',
  'surveying-violation-requirements.md',
  'planning-violation-requirements.md',
];

/** 「第 N、N、N 条」这类多条款引用先整组摘出来，免得组内的「、」被当分隔符。 */
const ARTICLE_GROUP = /第\s*\d+(?:\s*、\s*\d+)*\s*条(?:\s*第\s*\d+\s*款)?(?:\s*第\s*\d+\s*项)?/g;

/**
 * 把一段条文引用拆成条号清单。
 * 「第 44、46、53 条」拆成三条；「4.4.2.2(1)、2.3(5)」按「、」拆成两条；
 * 其余形态原样保留，不做有损改写。
 */
function splitArticles(text) {
  const groups = [];
  const masked = text.replace(ARTICLE_GROUP, (match) => {
    groups.push(match);
    return `\u0000${groups.length - 1}\u0000`;
  });
  const parts = masked.split('、').map((part) => part.trim()).filter((part) => part !== '');
  const result = [];
  for (const part of parts) {
    const placeholders = part.match(/\u0000(\d+)\u0000/g);
    if (!placeholders) {
      result.push(part);
      continue;
    }
    const remainder = part.replace(/\u0000\d+\u0000/g, '').trim();
    if (remainder !== '') result.push(remainder);
    for (const placeholder of placeholders) {
      const index = Number(placeholder.slice(1, -1));
      result.push(...expandArticleGroup(groups[index]));
    }
  }
  return result;
}

/** 「第 44、46、53 条」展开成「第 44 条」「第 46 条」「第 53 条」。 */
function expandArticleGroup(group) {
  const matched = /^第\s*(\d+(?:\s*、\s*\d+)*)\s*条(.*)$/.exec(group);
  if (!matched) return [group];
  const suffix = matched[2].trim();
  return matched[1].split('、').map((number) => `第 ${number.trim()} 条${suffix}`);
}

/** 依据栏解析：每段以「文件编号」开头；解析不出文件编号的段落原样留在 basisNote。 */
function parseBasis(cell) {
  const entries = [];
  const notes = [];
  for (const segment of cell.split('；')) {
    const trimmed = segment.trim();
    if (trimmed === '') continue;
    const matched = /^doc_(\d{3})\s*(.*)$/.exec(trimmed);
    if (!matched) {
      notes.push(trimmed);
      continue;
    }
    const document = `doc_${matched[1]}`;
    const rest = matched[2].trim().replace(/（/g, '(').replace(/）/g, ')').replace(/\s+/g, ' ').trim();
    if (rest === '') {
      entries.push({ document, article: '' });
      continue;
    }
    for (const article of splitArticles(rest)) entries.push({ document, article });
  }
  return { entries, notes };
}

/** 必填性归一：主取值必填／选填；条件说明留在 condition 里，不改主取值。 */
function parseRequired(raw) {
  const text = raw.trim();
  if (text === '必填') return { required: true, condition: null };
  if (text === '选填') return { required: false, condition: null };
  const parenthesised = /^必填（(.+)）$/.exec(text);
  if (parenthesised) return { required: true, condition: parenthesised[1] };
  return { required: true, condition: text };
}

function readTypeLayer() {
  const items = [];
  for (const draft of REQUIREMENT_DRAFTS) {
    const markdown = readDoc(draft);
    for (const line of markdown.split('\n')) {
      if (!/^\|\s*type\.[a-z0-9_]+\.[a-z0-9_]+\s*\|/.test(line)) continue;
      const cells = line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim());
      if (cells.length !== 7) {
        throw new Error(`${draft} 的要件行不是 7 列：${line}`);
      }
      const [key, label, group, requiredRaw, timing, consequence, basisCell] = cells;
      const { required, condition } = parseRequired(requiredRaw);
      const { entries, notes } = parseBasis(basisCell);
      const item = { key, label, group, required, timing, consequence, basis: entries };
      if (condition !== null) item.condition = condition;
      if (notes.length > 0) item.basisNote = notes.join('；');
      items.push(item);
    }
  }
  return items;
}

// ---- 产物渲染 ----

function tsString(value) {
  return JSON.stringify(value);
}

function renderReferenceData(sourceCodes, violationTypes, documents, basisRows, jurisdictionRows, dispatchGuidanceRows) {
  const lines = [];
  lines.push('// 参照数据初值（生成文件，勿手工改）。');
  lines.push('// 由 tools/generate-clue-reference-data.mjs 从 docs/research/ 下的定稿底稿生成。');
  lines.push('// 事实源：线索来源编码表（#24）、违法类型编码表与依据文件表（#203）、辖区对应（业务方交付）。');
  lines.push('// ADR 0016：参照数据以「业务编码 + 版本」为键，随种子只追加写入。');
  lines.push('');
  lines.push('/** 线索来源编码。parentCode 显式存上级编码，不按前缀推断。 */');
  lines.push('export const SOURCE_CODES = [');
  for (const row of sourceCodes) {
    lines.push(
      `  { code: ${tsString(row.code)}, name: ${tsString(row.name)}, parentCode: ${row.parentCode === null ? 'null' : tsString(row.parentCode)} },`,
    );
  }
  lines.push('] as const;');
  lines.push('');
  lines.push('/** 违法类型编码。selectable=false 的是大类分组行：录入时不可选，不进要件键。 */');
  lines.push('export const VIOLATION_TYPES = [');
  for (const row of violationTypes) {
    lines.push(
      `  { code: ${tsString(row.code)}, name: ${tsString(row.name)}, domain: ${tsString(row.domain)}, parentCode: ${row.parentCode === null ? 'null' : tsString(row.parentCode)}, selectable: ${row.selectable}, appendix: ${row.appendix === null ? 'null' : tsString(row.appendix)} },`,
    );
  }
  lines.push('] as const;');
  lines.push('');
  lines.push('/** 依据文件表。效力层级九档、效力状态三值（GLOSSARY）。 */');
  lines.push('export const DOCUMENTS = [');
  for (const row of documents) {
    lines.push(
      `  { code: ${tsString(row.code)}, name: ${tsString(row.name)}, hierarchyLevel: ${tsString(row.hierarchyLevel)}, validityStatus: ${tsString(row.validityStatus)}, note: ${row.note === null ? 'null' : tsString(row.note)} },`,
    );
  }
  lines.push('] as const;');
  lines.push('');
  lines.push('/** 违法类型的依据引用（ADR 0019）：文件编号 + 条号 + 用途。 */');
  lines.push('export const VIOLATION_TYPE_BASIS = [');
  for (const row of basisRows) {
    lines.push(
      `  { typeCode: ${tsString(row.typeCode)}, documentCode: ${tsString(row.documentCode)}, articleNo: ${tsString(row.articleNo)}, purpose: ${tsString(row.purpose)} },`,
    );
  }
  lines.push('] as const;');
  lines.push('');
  lines.push('/** 辖区对应（街道（镇）编码 → 机构）。业务方未交付前为空表。 */');
  lines.push('export const JURISDICTION_ROWS = [');
  for (const row of jurisdictionRows) {
    lines.push(
      `  { code: ${tsString(row.code)}, name: ${tsString(row.name)}, orgCode: ${tsString(row.orgCode)}, orgName: ${tsString(row.orgName)} },`,
    );
  }
  lines.push('] as const;');
  lines.push('');
  lines.push('/** 规划类违法类型分派指导（#207 P7）。guidance: system-internal | case-by-case | external。 */');
  lines.push('export const DISPATCH_GUIDANCE = [');
  for (const row of dispatchGuidanceRows) {
    lines.push(
      `  { typeCode: ${tsString(row.typeCode)}, guidance: ${tsString(row.guidance)} },`,
    );
  }
  lines.push('] as const;');
  lines.push('');
  return lines.join('\n');
}

function renderTypeLayer(items) {
  const lines = [];
  lines.push('// 类型层录入要件声明（生成文件，勿手工改）。');
  lines.push('// 由 tools/generate-clue-reference-data.mjs 从 #181–#184 四份草案（经 #203 回改）生成。');
  lines.push('// ADR 0018：录入要件是代码里的声明式常量，表单渲染与缺件判定读同一份。');
  lines.push('// 要件键形如 type.<违法类型编码>.<字段>（ADR 0020）。');
  lines.push('// 依据按 ADR 0019 写「文件编号 + 条号」，指向文件表。');
  lines.push('');
  lines.push('import type { TypeLayerItem } from \'./types.ts\';');
  lines.push('');
  lines.push('export const TYPE_LAYER_ITEMS: readonly TypeLayerItem[] = [');
  for (const item of items) {
    const parts = [
      `key: ${tsString(item.key)}`,
      `label: ${tsString(item.label)}`,
      `group: ${tsString(item.group)}`,
      `required: ${item.required}`,
      `timing: ${tsString(item.timing)}`,
      `consequence: ${tsString(item.consequence)}`,
    ];
    if (item.condition !== undefined) parts.push(`condition: ${tsString(item.condition)}`);
    const basis = item.basis
      .map((entry) => `{ document: ${tsString(entry.document)}, article: ${tsString(entry.article)} }`)
      .join(', ');
    parts.push(`basis: [${basis}]`);
    if (item.basisNote !== undefined) parts.push(`basisNote: ${tsString(item.basisNote)}`);
    lines.push(`  { ${parts.join(', ')} },`);
  }
  lines.push('];');
  lines.push('');
  return lines.join('\n');
}

// ---- 主流程 ----

function build() {
  const sourceCodes = readSourceCodes();
  const violationTypes = readViolationTypes();
  const documents = readDocuments();
  const jurisdictionRows = readJurisdiction();
  const dispatchGuidanceRows = readDispatchGuidance();
  const typeLayerItems = readTypeLayer();

  // 类型层依据：从类型层声明的「依据」栏归集到违法类型上，用途取「认定标准」。
  // 「处罚」「裁量基准」「移送处分」三类依据尚未定稿（#203 留言：未做），后续按只追加补版本。
  const basisSeen = new Set();
  const basisRows = [];
  for (const item of typeLayerItems) {
    const typeCode = item.key.split('.')[1];
    for (const entry of item.basis) {
      const key = `${typeCode}|${entry.document}|${entry.article}`;
      if (basisSeen.has(key)) continue;
      basisSeen.add(key);
      basisRows.push({
        typeCode,
        documentCode: entry.document,
        articleNo: entry.article,
        purpose: '认定标准',
      });
    }
  }

  return {
    reference:
      renderReferenceData(sourceCodes, violationTypes, documents, basisRows, jurisdictionRows, dispatchGuidanceRows),
    typeLayer: renderTypeLayer(typeLayerItems),
    counts: {
      sourceCodes: sourceCodes.length,
      violationTypes: violationTypes.length,
      documents: documents.length,
      basisRows: basisRows.length,
      jurisdictionRows: jurisdictionRows.length,
      typeLayerItems: typeLayerItems.length,
    },
  };
}

function main() {
  const check = process.argv.includes('--check');
  const built = build();
  const outputs = [
    [REFERENCE_OUTPUT, built.reference],
    [TYPE_LAYER_OUTPUT, built.typeLayer],
  ];
  let drifted = false;
  for (const [path, content] of outputs) {
    const relative = path.slice(ROOT.length + 1);
    if (check) {
      let current = null;
      try {
        current = readFileSync(path, 'utf8');
      } catch {
        current = null;
      }
      if (current !== content) {
        process.stderr.write(`[FAIL] ${relative} 与底稿不一致（重跑 node tools/generate-clue-reference-data.mjs）\n`);
        drifted = true;
      }
    } else {
      writeFileSync(path, content);
      process.stdout.write(`已生成 ${relative}\n`);
    }
  }
  if (check) {
    if (drifted) {
      process.stderr.write('生成物校验失败：底稿与入库产物不一致。\n');
      process.exit(1);
    }
    process.stdout.write('生成物校验通过：入库产物与底稿一致。\n');
    return;
  }
  process.stdout.write(`数量核对：${JSON.stringify(built.counts)}\n`);
}

main();
