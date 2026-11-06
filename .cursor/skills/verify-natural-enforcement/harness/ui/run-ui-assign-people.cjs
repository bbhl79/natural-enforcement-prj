#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * 承办机构内勤打开办理页，用现有「派出承办人」写到 handler_assigned。
 * 线索由 API 造到 org_assigned。不改控件文案。证据目录由 EVIDENCE_DIR 指定。
 * Env: BASE_URL, EVIDENCE_DIR, SEED_PASSWORD, VERIFY_NEW_PASSWORD
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

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

function writeJson(name, value) {
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'evidence', name), JSON.stringify(value, null, 2));
}

function sessionCookie(response) {
  const listed = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  const found = listed.find((item) => item.startsWith('__Host-sid='));
  if (found) return found.split(';')[0];
  const raw = response.headers.get('set-cookie') || '';
  const match = raw.match(/__Host-sid=[^;]+/);
  if (!match) throw new Error('缺少会话 Cookie');
  return match[0];
}

async function readBody(response) {
  const text = await response.text();
  if (text === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

async function postJson(cookie, apiPath, body) {
  const response = await fetch(`${BASE_URL}${apiPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await readBody(response), cookie: response };
}

async function getJson(cookie, apiPath) {
  const response = await fetch(`${BASE_URL}${apiPath}`, { headers: { cookie } });
  return { status: response.status, body: await readBody(response) };
}

async function loginMobile(mobile, passwords) {
  let last = null;
  for (const password of passwords) {
    const response = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mobilePhone: mobile, password, rememberMe: false }),
    });
    const body = await readBody(response);
    last = { status: response.status, body };
    if (response.status !== 200) continue;
    const cookie = sessionCookie(response);
    const result = body.result;
    if (result === 'password-change-required' || result === 'password-expired') {
      const changed = await postJson(cookie, '/api/auth/password', {
        currentPassword: password,
        newPassword: FINAL_PASSWORD,
      });
      if (changed.status !== 200) {
        throw new Error(`改密失败 ${mobile} ${changed.status} ${JSON.stringify(changed.body)}`);
      }
    }
    return cookie;
  }
  throw new Error(`登录失败 ${mobile} ${JSON.stringify(last)}`);
}

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

async function main() {
  const notes = [];
  const admin = await loginMobile('13800001231', [FINAL_PASSWORD, SEED_PASSWORD]);
  const hq = await loginMobile('13800001004', [FINAL_PASSWORD, SEED_PASSWORD]);
  const tree = await getJson(hq, '/api/org-units');
  if (tree.status !== 200) throw new Error(`机构树 ${tree.status} ${JSON.stringify(tree.body)}`);
  const units = tree.body.orgUnits || [];
  const deptA = units.find((org) => org.code === 'ORG-DEPT-A');
  const station = units.find((org) => org.code === 'ORG-STATION-A');
  if (!deptA || !station) throw new Error('缺少甲区或甲区执法所');

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
    if (created.status === 200) return loginMobile(spec.mobile, [INITIAL_PASSWORD]);
    if (created.status === 409 && created.body.result === 'already-exists') {
      return loginMobile(spec.mobile, [FINAL_PASSWORD, INITIAL_PASSWORD]);
    }
    throw new Error(`建员失败 ${spec.code} ${created.status} ${JSON.stringify(created.body)}`);
  }

  const intake = await ensureClerk({
    code: 'P-INTAKE-A',
    name: '甲区内勤',
    orgUnitId: deptA.id,
    mobile: '13900002001',
    roles: ['内勤'],
  });
  const stationClerk = await ensureClerk({
    code: 'P-INTAKE-ST',
    name: '甲所内勤',
    orgUnitId: station.id,
    mobile: '13900002003',
    roles: ['内勤'],
  });
  const clerk = await loginMobile('13800001002', [FINAL_PASSWORD, SEED_PASSWORD]);
  const outsider = await loginMobile('13800001008', [FINAL_PASSWORD, SEED_PASSWORD]);

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
  try {
    await page.goto(`${BASE_URL}/auth/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByRole('textbox', { name: '手机号' }).fill('13900002003');
    await page.locator('input[name="password"]').fill(FINAL_PASSWORD);
    await Promise.all([
      page.waitForURL((url) => !String(url).includes('/auth/login'), { timeout: 20000 }).catch(() => null),
      page.getByRole('button', { name: '登录' }).click(),
    ]);
    await page.waitForTimeout(800);
    if (page.url().includes('/auth/password')) {
      await page.locator('input[name="newPassword"]').fill(FINAL_PASSWORD);
      await page.locator('input[name="confirmPassword"]').fill(FINAL_PASSWORD);
      await page.getByRole('button', { name: '更换口令' }).click();
      await page.waitForTimeout(800);
    }
    await shot('01-after-login');
    if (page.url().includes('/auth/login') || page.url().includes('/auth/password')) {
      throw new Error(`甲所内勤未离开登录 ${page.url()}`);
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
    failed = true;
    await shot('error').catch(() => null);
    writeJson('error.json', { message: String((error && error.stack) || error) });
  }

  writeJson('api-log.json', apiLog);
  writeJson('setup-notes.json', { clueId, main, stationOrgId: station.id, deptAId: deptA.id, notes });
  await context.tracing.stop({ path: path.join(EVIDENCE_DIR, 'evidence', 'trace.zip') });
  await context.close();
  await browser.close();

  const summary = {
    status: failed ? 'failed' : 'passed',
    clueId,
    baseUrl: BASE_URL,
    mode: 'headless',
  };
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, 'evidence', 'error.json'),
    JSON.stringify({ message: String((error && error.stack) || error) }, null, 2),
  );
  console.error(error);
  process.exit(1);
});
