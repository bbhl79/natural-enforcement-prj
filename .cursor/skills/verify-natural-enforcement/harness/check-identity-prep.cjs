'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { classifyTransport } = require('./transport-gate.cjs');

const FORBIDDEN_KEYS = new Set([
  'password',
  'currentpassword',
  'newpassword',
  'seed',
  'secret',
  'hash',
  'passwordhash',
]);

function fail(message) {
  const error = new Error(message);
  error.code = 'IDENTITY_PREP_INVALID';
  throw error;
}

function walk(value, at) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${at}[${index}]`));
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) fail(`快照含禁止字段 ${at}.${key}`);
    walk(child, `${at}.${key}`);
  }
}

function readSnapshot(file) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  walk(parsed, path.basename(file));
  const name = path.basename(file);
  if (typeof parsed.takenAt !== 'string' || parsed.takenAt.trim() === '') fail(`${name} 缺少 takenAt`);
  if (typeof parsed.gitTip !== 'string' || !/^[0-9a-f]{7,64}$/i.test(parsed.gitTip)) {
    fail(`${name} 缺少 gitTip`);
  }
  if (typeof parsed.baseUrl !== 'string' || classifyTransport(parsed.baseUrl).ok !== true) {
    fail(`${name} 的 baseUrl 偏离获准传输`);
  }
  if (typeof parsed.expectedClient !== 'string' || parsed.expectedClient.trim() === '') {
    fail(`${name} 缺少 expectedClient`);
  }
  if (typeof parsed.sourceIp !== 'string' || parsed.sourceIp.trim() === '') fail(`${name} 缺少 sourceIp`);
  if (typeof parsed.health?.status !== 'string' || parsed.health.status.trim() === '') {
    fail(`${name} 缺少 health.status`);
  }
  if (!Array.isArray(parsed.containers) || parsed.containers.length === 0) fail(`${name} 缺少 containers`);
  for (const container of parsed.containers) {
    if (typeof container.name !== 'string' || container.name.trim() === '') fail('容器缺少 name');
    if (typeof container.id !== 'string' || container.id.trim() === '') fail('容器缺少 id');
    if (typeof container.startedAt !== 'string' || container.startedAt.trim() === '') {
      fail('容器缺少 startedAt');
    }
  }
  if (!Array.isArray(parsed.identities) || parsed.identities.length === 0) fail(`${name} 缺少 identities`);
  for (const identity of parsed.identities) {
    if (typeof identity.id !== 'string' || identity.id.trim() === '') fail('身份缺少 id');
    if (typeof identity.mobile !== 'string' || identity.mobile.trim() === '') fail('身份缺少 mobile');
    const changed = identity.passwordChangedAt;
    if (changed !== null && typeof changed !== 'string') fail('passwordChangedAt 只能是字符串或 null');
  }
  if (parsed.latestAuthAction !== null && typeof parsed.latestAuthAction !== 'string') {
    fail('latestAuthAction 只能是字符串或 null');
  }
  return parsed;
}

function validateIdentityPrep(dir) {
  const resolved = path.resolve(dir);
  if (resolved.includes(`${path.sep}.run${path.sep}verify-`)) {
    fail('快照目录不得位于 .run/verify-*');
  }
  const before = readSnapshot(path.join(resolved, 'before.json'));
  const after = readSnapshot(path.join(resolved, 'after.json'));
  if (before.takenAt === after.takenAt) fail('before.json 与 after.json 的 takenAt 相同');
  return { before: before.takenAt, after: after.takenAt };
}

function main() {
  const dir = process.argv[2];
  if (!dir || process.argv.length !== 3) {
    console.error('[FAIL] 用法: check-identity-prep.cjs <快照目录>');
    process.exit(2);
  }
  try {
    const result = validateIdentityPrep(dir);
    console.log(JSON.stringify({ ok: true, ...result }));
  } catch (error) {
    console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

module.exports = { validateIdentityPrep };

if (require.main === module) main();
