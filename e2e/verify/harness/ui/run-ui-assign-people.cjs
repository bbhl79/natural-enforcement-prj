#!/usr/bin/env node
// 用途：Playwright 驱动办理页的「派出承办人」，把线索从 org_assigned 写到 handler_assigned。
// 用法：由 run-ui-assign-people.sh 调用；EVIDENCE_DIR 必填，BASE_URL 可覆盖。
// 退出码：0 全绿；1 有失败或认证门禁 blocked；2 缺少 EVIDENCE_DIR。
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * 承办机构内勤打开办理页，用现有「派出承办人」写到 handler_assigned。
 * 线索由 API 造到 org_assigned。不改控件文案。证据目录由 EVIDENCE_DIR 指定。
 * Env: BASE_URL, EVIDENCE_DIR, SEED_PASSWORD, VERIFY_NEW_PASSWORD
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

// 按同目录或上级目录查找并加载 auth-gate.cjs；都找不到时抛错。
function loadAuthGate() {
  const candidates = [
    path.join(__dirname, 'auth-gate.cjs'),
    path.join(__dirname, '..', 'auth-gate.cjs'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return require(candidate);
  }
  throw new Error('缺少 auth-gate.cjs');
}
const {
  AuthGateError,
  assertLoginAccepted,
  assertNoSourceOverride,
  changePasswordOnce,
  isAuthGateError,
  loginPageOnce,
  loginPassword,
} = loadAuthGate();

const BASE_URL = (process.env.BASE_URL || 'https://host.docker.internal:8080').replace(/\/$/, '');
const EVIDENCE_DIR = process.env.EVIDENCE_DIR;
const SEED_PASSWORD = process.env.SEED_PASSWORD || 'Seed-pass-52';
const FINAL_PASSWORD = process.env.VERIFY_NEW_PASSWORD || 'Verify-assign-52!';
const INITIAL_PASSWORD = process.env.VERIFY_INITIAL_PASSWORD || 'Station-init-52!';

if (!EVIDENCE_DIR) {
  console.error('EVIDENCE_DIR required');
  process.exit(2);
}
fs.mkdirSync(path.join(EVIDENCE_DIR, 'evidence'), { recursive: true });

// 把 JSON 写到证据目录 evidence/ 下。
function writeJson(name, value) {
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'evidence', name), JSON.stringify(value, null, 2));
}

// 从登录响应提取 __Host-sid Cookie 对；缺失时抛错。
function sessionCookie(response) {
  const listed = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  const found = listed.find((item) => item.startsWith('__Host-sid='));
  if (found) return found.split(';')[0];
  const raw = response.headers.get('set-cookie') || '';
  const match = raw.match(/__Host-sid=[^;]+/);
  if (!match) throw new Error('缺少会话 Cookie');
  return match[0];
}

// 读响应体并尽量解析 JSON；解析失败返回截断原文。
async function readBody(response) {
  const text = await response.text();
  if (text === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

// 以 JSON 发 POST，返回状态、解析后的响应体与原始响应。
async function postJson(cookie, apiPath, body) {
  const response = await fetch(`${BASE_URL}${apiPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await readBody(response), cookie: response };
}

// 带 Cookie 发 GET，返回状态与解析后的响应体。
async function getJson(cookie, apiPath) {
  const response = await fetch(`${BASE_URL}${apiPath}`, { headers: { cookie } });
  return { status: response.status, body: await readBody(response) };
}

// 用手机号与口令登录；首登或过期时改密，返回 Cookie 与当前口令。
async function loginOnce(mobile, password) {
  const headers = { 'content-type': 'application/json' };
  assertNoSourceOverride(headers);
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ mobilePhone: mobile, password, rememberMe: false }),
  });
  const body = await readBody(response);
  assertLoginAccepted(response.status, body);
  const cookie = sessionCookie(response);
  const result = body.result;
  let current = password;
  if (result === 'password-change-required' || result === 'password-expired') {
    const changed = await postJson(cookie, '/api/auth/password', {
      currentPassword: password,
      newPassword: FINAL_PASSWORD,
    });
    if (changed.status !== 200) {
      throw new AuthGateError('auth-rejected', changed.status, JSON.stringify(changed.body));
    }
    current = FINAL_PASSWORD;
  }
  return { cookie, password: current };
}

// 以偏移量生成约 0.1 度见方的合成多边形环。
function square(offset) {
  const west = 113 + offset;
  return [
    [west, 23],
    [west + 0.1, 23],
    [west + 0.1, 23.1],
    [west, 23.1],
    [west, 23],
  ];
}

// 经 API 登记一条土地线索，返回状态与响应体。
async function registerClue(cookie, offset) {
  const form = new FormData();
  form.set('sourceCode', '16');
  form.set('domain', 'land');
  form.set(
    'values',
    JSON.stringify({
      'clue.received_at': '2026-10-25',
      'clue.narrative': '巡查发现一处硬化地面',
      'clue.finder': '巡查员甲',
      'clue.patrol_no': 'XC-2026-ASSIGN',
    }),
  );
  const polygon = JSON.stringify({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [square(offset)] },
    properties: {},
  });
  form.set('spatial-source', new Blob([polygon], { type: 'application/geo+json' }), 'area.geojson');
  const response = await fetch(`${BASE_URL}/api/clues`, {
    method: 'POST',
    headers: { cookie, 'idempotency-key': `assign-people-${offset}-${Date.now()}` },
    body: form,
  });
  return { status: response.status, body: await readBody(response) };
}

// 建员并造线索，再驱动页面派出承办人，写证据后按结果退出。
async function main() {
  const notes = [];
  const declared = loginPassword(SEED_PASSWORD);
  const admin = (await loginOnce('13800001231', declared)).cookie;
  const hq = (await loginOnce('13800001004', declared)).cookie;
  const tree = await getJson(hq, '/api/org-units');
  if (tree.status !== 200) throw new Error(`机构树 ${tree.status} ${JSON.stringify(tree.body)}`);
  const units = tree.body.orgUnits || [];
  const deptA = units.find((org) => org.code === 'ORG-DEPT-A');
  const station = units.find((org) => org.code === 'ORG-STATION-A');
  if (!deptA || !station) throw new Error('缺少甲区或甲区执法所');

  // 建内勤人员；已存在时按声明的单一登录口令登录。
  async function ensureClerk(spec) {
    const created = await postJson(admin, '/api/admin/personnel', {
      code: spec.code,
      name: spec.name,
      orgUnitId: spec.orgUnitId,
      mobilePhone: spec.mobile,
      initialPassword: INITIAL_PASSWORD,
      roles: spec.roles,
    });
    notes.push({ ensure: spec.code, status: created.status, result: created.body.result, conflict: created.body.conflict });
    if (created.status === 200) return loginOnce(spec.mobile, INITIAL_PASSWORD);
    if (created.status === 409 && created.body.result === 'already-exists') {
      if (!process.env.VERIFY_LOGIN_PASSWORD) {
        throw new AuthGateError('auth-rejected', 409, `身份 ${spec.code} 已存在且未声明单一登录口令`);
      }
      return loginOnce(spec.mobile, process.env.VERIFY_LOGIN_PASSWORD);
    }
    throw new Error(`建员失败 ${spec.code} ${created.status} ${JSON.stringify(created.body)}`);
  }

  const intake = (await ensureClerk({
    code: 'P-INTAKE-A',
    name: '甲区内勤',
    orgUnitId: deptA.id,
    mobile: '13900002001',
    roles: ['内勤'],
  })).cookie;
  const stationSession = await ensureClerk({
    code: 'P-INTAKE-ST',
    name: '甲所内勤',
    orgUnitId: station.id,
    mobile: '13900002003',
    roles: ['内勤'],
  });
  const stationClerk = stationSession.cookie;
  const clerk = (await loginOnce('13800001002', declared)).cookie;
  const outsider = (await loginOnce('13800001008', declared)).cookie;

  const offset = 59;
  const first = await registerClue(clerk, offset);
  const second = await registerClue(clerk, offset);
  writeJson('register.json', { first, second, notes });
  if (second.status !== 201 || !second.body.id) {
    throw new Error(`登记失败 ${second.status} ${JSON.stringify(second.body)}`);
  }
  const clueId = second.body.id;
  let status = second.body.status;
  if (status === 'pending_decision') {
    const decided = await postJson(clerk, `/api/clues/${clueId}/decide`, {
      decision: 'dispatch',
      acknowledged: true,
      expectedStatus: 'pending_decision',
    });
    writeJson('decide.json', decided);
    if (decided.status !== 200) throw new Error(`决定失败 ${JSON.stringify(decided)}`);
    status = decided.body.status;
  }
  const assigned = await postJson(intake, `/api/clues/${clueId}/assign-org`, {
    orgUnitId: station.id,
    expectedStatus: status,
    reason: '',
    designate: false,
  });
  writeJson('assign-org.json', assigned);
  if (assigned.status !== 200) throw new Error(`派机构失败 ${JSON.stringify(assigned)}`);

  const before = await getJson(stationClerk, `/api/clues/${clueId}/dispatch`);
  const intakeView = await getJson(intake, `/api/clues/${clueId}/dispatch`);
  const clerkView = await getJson(clerk, `/api/clues/${clueId}/dispatch`);
  const outsiderView = await getJson(outsider, `/api/clues/${clueId}/dispatch`);
  const duplicates = await getJson(stationClerk, `/api/clues/${clueId}/duplicates`);
  const verification = await getJson(stationClerk, `/api/clues/${clueId}/verification`);
  const orgUnits = await getJson(stationClerk, '/api/org-units');
  writeJson('dispatch-station-before.json', before);
  writeJson('dispatch-intake.json', intakeView);
  writeJson('dispatch-clerk.json', clerkView);
  writeJson('dispatch-outsider.json', outsiderView);
  writeJson('duplicates-station.json', duplicates);
  writeJson('verification-station.json', verification);
  writeJson('org-units-station.json', { status: orgUnits.status, count: (orgUnits.body.orgUnits || []).length });

  const candidates = (before.body && before.body.candidates) || [];
  const main = candidates.find((person) => person.code !== 'P-INTAKE-ST') || candidates[0];
  if (!main) throw new Error('承办机构没有可选承办人');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    locale: 'zh-CN',
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: path.join(EVIDENCE_DIR, 'evidence'), size: { width: 1440, height: 900 } },
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  const page = await context.newPage();
  const apiLog = [];
  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/api/')) apiLog.push({ method: response.request().method(), status: response.status(), url });
  });
  const shot = async (name) => {
    const rel = `evidence/${name}.png`;
    await page.screenshot({ path: path.join(EVIDENCE_DIR, rel), fullPage: true });
    return rel;
  };

  let failed = false;
  let blocked = false;
  try {
    await loginPageOnce(page, BASE_URL, '13900002003', stationSession.password);
    await changePasswordOnce(page, FINAL_PASSWORD);
    await shot('01-after-login');
    if (page.url().includes('/auth/login') || page.url().includes('/auth/password')) {
      throw new AuthGateError('auth-rejected', null, `甲所内勤未离开登录 ${page.url()}`);
    }

    await page.goto(`${BASE_URL}/workbench?step=3&clue=${encodeURIComponent(clueId)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    const assignButton = page.locator('[data-role="assign-people"]');
    await assignButton.waitFor({ state: 'visible', timeout: 30000 }).catch(() => null);
    const beforeText = await page.locator('body').innerText();
    const beforeFields = await page.evaluate(() => {
      const roles = [...document.querySelectorAll('[data-role]')].map((node) => node.getAttribute('data-role'));
      return { roles: [...new Set(roles)], url: location.href };
    });
    await shot('02-dispatch-before-click');
    writeJson('page-before.json', {
      fields: beforeFields,
      hasAssignPeople: beforeText.includes('派出承办人'),
      hasLoadError: beforeText.includes('分派办理没有加载出来'),
      hasHitGroups: beforeFields.roles.includes('hit-groups') || beforeFields.roles.includes('hit-group'),
      hasNoHits: beforeFields.roles.includes('no-hits'),
      hasSuggestion: beforeFields.roles.includes('suggestion') || beforeFields.roles.includes('suggestion-empty'),
      snippet: beforeText.slice(0, 1500),
    });
    if (!beforeFields.roles.includes('assign-people') || beforeText.includes('分派办理没有加载出来')) {
      throw new Error('办理页没有派出承办人');
    }

    await page.locator('#dispatch-main').selectOption(main.personnelId);
    await shot('03-main-selected');
    const clicked = page.waitForResponse(
      (response) => response.url().includes('/assign-people') && response.request().method() === 'POST',
      { timeout: 20000 },
    );
    await assignButton.click();
    const posted = await clicked;
    const postedBody = await posted.json().catch(() => ({}));
    writeJson('assign-people-response.json', { status: posted.status(), body: postedBody });
    await page.getByText('已派承办人').first().waitFor({ state: 'visible', timeout: 20000 });
    await shot('04-after-click');
    const afterText = await page.locator('body').innerText();
    const afterRead = await getJson(stationClerk, `/api/clues/${clueId}/dispatch`);
    writeJson('dispatch-station-after.json', afterRead);
    writeJson('page-after.json', {
      snippet: afterText.slice(0, 1500),
      showsHandlerAssigned: afterText.includes('已派承办人'),
    });
    if (posted.status() !== 200 || afterRead.body.status !== 'handler_assigned') {
      throw new Error(`未写到 handler_assigned：页面 ${posted.status()} 回读 ${afterRead.body.status}`);
    }
  } catch (error) {
    if (isAuthGateError(error)) blocked = true;
    else failed = true;
    await shot('error').catch(() => null);
    writeJson('error.json', { message: String((error && error.stack) || error) });
  }

  writeJson('api-log.json', apiLog);
  writeJson('setup-notes.json', { clueId, main, stationOrgId: station.id, deptAId: deptA.id, notes });
  await context.tracing.stop({ path: path.join(EVIDENCE_DIR, 'evidence', 'trace.zip') });
  await context.close();
  await browser.close();

  const summary = {
    status: blocked ? 'blocked' : failed ? 'failed' : 'passed',
    clueId,
    baseUrl: BASE_URL,
    mode: 'headless',
  };
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
  process.exit(blocked || failed ? 1 : 0);
}

main().catch((error) => {
  const blocked = isAuthGateError(error);
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, 'summary.json'),
    JSON.stringify({ status: blocked ? 'blocked' : 'failed', error: String((error && error.stack) || error) }, null, 2),
  );
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, 'evidence', 'error.json'),
    JSON.stringify({ message: String((error && error.stack) || error) }, null, 2),
  );
  console.error(error);
  process.exit(1);
});
