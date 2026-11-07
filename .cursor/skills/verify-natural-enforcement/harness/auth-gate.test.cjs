'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const gate = require('./auth-gate.cjs');
const prep = require('./check-identity-prep.cjs');
const transport = require('./transport-gate.cjs');

const ROOT = path.resolve(__dirname, '../../..');

test('来源受限标记立即 blocked', () => {
  const marked = gate.classifyLogin(401, { action: 'login.source-limited' });
  assert.equal(marked.ok, false);
  assert.equal(marked.reason, 'source-limited');
  const text = gate.classifyLogin(401, '401 来源受限');
  assert.equal(text.reason, 'source-limited');
});

test('与口令错误同形的 401 也停止，且不叫业务通过', () => {
  const verdict = gate.classifyLogin(401, { result: 'invalid-credential' });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.blocked, true);
  assert.equal(verdict.reason, 'auth-rejected');
  assert.throws(() => gate.assertLoginAccepted(401, { result: 'invalid-credential' }), gate.AuthGateError);
});

test('200 才放行，改写来源地址被拒绝', () => {
  assert.equal(gate.classifyLogin(200, { result: 'established' }).ok, true);
  assert.throws(
    () => gate.assertNoSourceOverride({ 'x-forwarded-for': '203.0.113.9' }),
    (error) => error.reason === 'source-switch',
  );
});

test('blocked 不会被失败步改写成 failed', () => {
  assert.equal(gate.summaryStatus('blocked', 2), 'blocked');
  assert.equal(gate.summaryStatus('passed', 1), 'failed');
  assert.equal(gate.summaryStatus('passed', 0), 'passed');
});

test('单一登录口令：显式值优先，空白则用种子', () => {
  const previous = process.env.VERIFY_LOGIN_PASSWORD;
  process.env.VERIFY_LOGIN_PASSWORD = 'declared-once';
  assert.equal(gate.loginPassword('seed'), 'declared-once');
  process.env.VERIFY_LOGIN_PASSWORD = '   ';
  assert.equal(gate.loginPassword('seed'), 'seed');
  if (previous === undefined) delete process.env.VERIFY_LOGIN_PASSWORD;
  else process.env.VERIFY_LOGIN_PASSWORD = previous;
});

test('compose 服务名 nginx 不是获准传输', () => {
  assert.equal(transport.classifyTransport('https://nginx').ok, false);
  assert.equal(transport.classifyTransport('https://nginx:8443/api').reason, 'compose-nginx');
  assert.equal(transport.classifyTransport('http://server').reason, 'compose-alias');
  assert.equal(transport.classifyTransport('https://host.docker.internal:8080').ok, true);
  assert.equal(transport.classifyTransport('https://localhost:8080').ok, true);
});

test('身份准备快照必须成对且不含口令', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-prep-'));
  const snapshot = {
    takenAt: '2026-11-07T18:00:00.000Z',
    gitTip: '7ccdeeef3b398a80cc34c7ffe60ec72b28ba4181',
    baseUrl: 'https://host.docker.internal:8080',
    expectedClient: 'host.docker.internal',
    sourceIp: '10.89.3.1',
    health: { status: 'ok' },
    containers: [{ name: 'nginx', id: 'abc', startedAt: '2026-11-07T17:28:20.000Z' }],
    latestAuthAction: null,
    identities: [{ id: 'clerk-a', mobile: '13800001002', passwordChangedAt: null }],
  };
  fs.writeFileSync(path.join(dir, 'before.json'), JSON.stringify(snapshot));
  fs.writeFileSync(
    path.join(dir, 'after.json'),
    JSON.stringify({ ...snapshot, takenAt: '2026-11-07T18:05:00.000Z' }),
  );
  assert.equal(prep.validateIdentityPrep(dir).ok, undefined);
  const leaked = { ...snapshot, takenAt: '2026-11-07T18:06:00.000Z', password: 'nope' };
  fs.writeFileSync(path.join(dir, 'after.json'), JSON.stringify(leaked));
  assert.throws(() => prep.validateIdentityPrep(dir), /禁止字段/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('可执行文件不写绕门禁步骤', () => {
  const forbidden = [
    /FLUSHDB/,
    /FLUSHALL/,
    /docker[[:space:]]+restart/,
    /docker[[:space:]]+network[[:space:]]+connect/,
    /redis-cli/,
    /VERIFY_EXTRA_PASSWORDS/,
    /for\s*\(\s*const\s+password\s+of/,
    /UPDATE[[:space:]]+personnel/i,
  ];
  const allow = new Set([
    path.join(__dirname, 'auth-gate.cjs'),
    path.join(__dirname, 'auth-gate.test.cjs'),
    path.join(__dirname, 'transport-gate.cjs'),
    path.join(__dirname, 'transport-gate.sh'),
  ]);
  const hits = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(cjs|mjs|ts|sh)$/.test(name)) continue;
      if (allow.has(full)) continue;
      const text = fs.readFileSync(full, 'utf8');
      for (const pattern of forbidden) {
        if (pattern.test(text)) hits.push(`${path.relative(ROOT, full)} ${pattern}`);
      }
      if (name !== 'auth-gate.cjs' && /['"]x-forwarded-for['"]/i.test(text)) {
        hits.push(`${path.relative(ROOT, full)} 设置了来源地址头`);
      }
    }
  };
  walk(path.join(__dirname, '..'));
  const session = fs.readFileSync(path.join(__dirname, 'session.ts'), 'utf8');
  const logins = session.split('/api/auth/login').length - 1;
  assert.equal(logins, 1);
  assert.deepEqual(hits, []);
});
