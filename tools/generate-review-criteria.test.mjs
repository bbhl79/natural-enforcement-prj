// 用途：L1 判据生成器的负例自测。八条断言各造一份坏底稿，断言生成器判红并点名该条断言。
// 调用方：dev 脚本的 lint criteria 子项（node --test）。
// 边界：只在内存里构造底稿；断言 8 读仓库内产物，不写盘。
// 依据：docs/research/criteria/README.md。

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { build, validate } from './generate-review-criteria.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT_PATH = 'docs/research/sources/doc_001.txt';
const SNAPSHOT = '第一条 本条规定测试期限九十日。\n第二条 本条规定五个工作日。\n';
const SNAPSHOT_HASH = createHash('sha256').update(SNAPSHOT).digest('hex');
const DOCUMENTS = new Map([
  ['doc_001', { code: 'doc_001', name: '测试法', hierarchyLevel: '法律', validityStatus: '现行有效' }],
]);

// 合法的测试底稿。每个用例取一份新副本再改坏。
function validDraft() {
  return {
    path: 'docs/research/criteria/doc_001.md',
    document: {
      code: 'doc_001',
      name: '测试法',
      effectiveOn: '2020-01-01',
      region: '全国',
      hierarchyLevel: '法律',
      sourceType: '法律',
      officialSources: ['https://example.gov.cn/a', 'https://example.gov.cn/b'],
      snapshot: SNAPSHOT_PATH,
      sha256: SNAPSHOT_HASH,
    },
    items: [
      {
        id: 'CRIT-DL-001',
        article: '第一条',
        interpretation: '直译',
        expected: { dayCount: 90 },
        sourceValues: { dayCount: '九十日' },
        consumers: ['backend/deadline/src/rules.ts#case.handle'],
        status: 'active',
        excerpt: '本条规定测试期限九十日。',
      },
    ],
  };
}

// 跑一次校验，返回错误列表。
function errorsOf(draft, documents = DOCUMENTS) {
  const sources = new Map([[SNAPSHOT_PATH, SNAPSHOT]]);
  return validate([draft], [], documents, sources, '2026-11-12').errors;
}

// 断言错误列表里有指定编号的断言。
function expectAssertion(errors, number) {
  assert.ok(
    errors.some((error) => error.includes(`[断言 ${number}]`)),
    `期望断言 ${number} 判红，实际：\n${errors.join('\n')}`,
  );
}

test('合法底稿零错误', () => {
  assert.deepEqual(errorsOf(validDraft()), []);
});

test('断言 1：原文哈希不符即红', () => {
  const draft = validDraft();
  draft.document.sha256 = '0'.repeat(64);
  expectAssertion(errorsOf(draft), 1);
});

test('断言 2：摘录不是原文子串即红', () => {
  const draft = validDraft();
  draft.items[0].excerpt = '本条规定测试期限三十日。';
  expectAssertion(errorsOf(draft), 2);
});

test('断言 3：条号无法定位即红', () => {
  const draft = validDraft();
  draft.items[0].article = '第九十九条';
  expectAssertion(errorsOf(draft), 3);
});

test('断言 4：引用已废止或存疑文件即红', () => {
  const repealed = new Map([
    ['doc_001', { code: 'doc_001', name: '测试法', hierarchyLevel: '法律', validityStatus: '已废止' }],
  ]);
  expectAssertion(errorsOf(validDraft(), repealed), 4);
  const doubtful = new Map([
    ['doc_001', { code: 'doc_001', name: '测试法', hierarchyLevel: '法律', validityStatus: '存疑' }],
  ]);
  expectAssertion(errorsOf(validDraft(), doubtful), 4);
});

test('断言 5：施行日晚于今日即红', () => {
  const draft = validDraft();
  draft.document.effectiveOn = '2099-01-01';
  expectAssertion(errorsOf(draft), 5);
});

test('断言 6：裁量型带期望值即红', () => {
  const draft = validDraft();
  draft.items[0].interpretation = '裁量';
  draft.items[0].riskNote = '测试风险';
  expectAssertion(errorsOf(draft), 6);
});

test('断言 7：推导链引用底稿外的判据即红', () => {
  const draft = validDraft();
  draft.items[0].interpretation = '推导';
  draft.items[0].derivation = ['CRIT-DL-999'];
  draft.items[0].excerpt = null;
  expectAssertion(errorsOf(draft), 7);
});

test('断言 8：入库产物与底稿渲染逐字节一致', () => {
  const { products, errors } = build(ROOT, '2026-11-12');
  assert.deepEqual(errors, []);
  for (const [path, content] of products) {
    assert.equal(readFileSync(join(ROOT, path), 'utf8'), content, `[断言 8] ${path} 与底稿不一致`);
  }
});