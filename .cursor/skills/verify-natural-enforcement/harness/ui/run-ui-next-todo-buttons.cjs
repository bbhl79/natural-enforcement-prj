#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * 下一待办按钮的 headless 页面取证。
 * 只读。不点派出、不点重新分派、不点派出承办人。
 * 甲所内勤打开分派页得到 403 与「分派办理没有加载出来」：这是修前基线。
 *
 * Env:
 *   BASE_URL
 *   EVIDENCE_DIR
 *   MANIFEST  clue-manifest.json
 *   SEED_PASSWORD
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = (process.env.BASE_URL || 'https://host.docker.internal:8080').replace(/\/$/, '');
const EVIDENCE_DIR = process.env.EVIDENCE_DIR;
const MANIFEST = process.env.MANIFEST || '';
const SEED_PASSWORD = process.env.SEED_PASSWORD || 'Seed-pass-52';
const NEW_PASSWORD = process.env.VERIFY_NEW_PASSWORD || 'Verify-skill-loop-52!';
const HEADED = process.env.HEADED === '1' || process.env.PW_HEADED === '1';
const SCENARIO_ID = 'vf-sc-next-todo-buttons';

if (!EVIDENCE_DIR || !MANIFEST) {
  console.error('EVIDENCE_DIR and MANIFEST required');
  process.exit(2);
}
fs.mkdirSync(path.join(EVIDENCE_DIR, 'evidence'), { recursive: true });
fs.mkdirSync(path.join(EVIDENCE_DIR, 'steps'), { recursive: true });

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const clues = manifest.clues || {};

const PEOPLE = [
  { id: 'clerk-a', mobile: '13800001002', label: '乙经办' },
  { id: 'intake-a', mobile: '13900002001', label: '甲区内勤' },
  { id: 'intake-st', mobile: '13900002003', label: '甲所内勤' },
];

const PHASES = [
  { key: 'inPool', stepId: 'ui-in-pool', status: 'in_pool' },
  { key: 'pendingDecision', stepId: 'ui-pending', status: 'pending_decision' },
  { key: 'orgAssigned', stepId: 'ui-org-assigned', status: 'org_assigned' },
];

function expectOf(phaseKey, identityId) {
  const denied = {
    dispatchHttp: 403,
    reason: 'scope-denied',
    text: ['分派办理没有加载出来'],
    absentText: ['派出承办人', '重新分派', '派出机构'],
    roles: {},
    absentRoles: ['decide-dispatch', 'decide-hold', 'assign-org', 'assign-people', 'assigned'],
    baseline: phaseKey === 'orgAssigned' ? 'pre-fix-read-entered-org' : 'entered-org-outside-station-scope',
  };
  if (identityId === 'intake-st') return denied;
  if (phaseKey === 'inPool' && identityId === 'clerk-a') {
    return {
      dispatchHttp: 200,
      text: ['待分派池的线索由本机构内勤派出'],
      absentText: ['派出承办人', '重新分派', '分派决定由录入人完成'],
      roles: {},
      absentRoles: ['decide-dispatch', 'decide-hold', 'assign-org', 'assign-people'],
    };
  }
  if (phaseKey === 'inPool' && identityId === 'intake-a') {
    return {
      dispatchHttp: 200,
      text: [],
      absentText: ['派出承办人', '待分派池的线索由本机构内勤派出'],
      roles: { 'assign-org': '派出机构' },
      absentRoles: ['decide-dispatch', 'decide-hold', 'assign-people'],
    };
  }
  if (phaseKey === 'pendingDecision' && identityId === 'clerk-a') {
    return {
      dispatchHttp: 200,
      text: [],
      absentText: ['分派决定由录入人完成', '派出承办人', '派出机构'],
      roles: { 'decide-dispatch': '已知晓并派出', 'decide-hold': '不派' },
      absentRoles: ['assign-org', 'assign-people'],
    };
  }
  if (phaseKey === 'pendingDecision' && identityId === 'intake-a') {
    return {
      dispatchHttp: 200,
      text: ['分派决定由录入人完成'],
      absentText: ['派出承办人', '派出机构', '已知晓并派出'],
      roles: {},
      absentRoles: ['decide-dispatch', 'decide-hold', 'assign-org', 'assign-people'],
    };
  }
  if (phaseKey === 'orgAssigned' && identityId === 'clerk-a') {
    return {
      dispatchHttp: 200,
      text: ['承办机构'],
      absentText: ['派出承办人', '重新分派'],
      roles: { assigned: '' },
      absentRoles: ['assign-org', 'assign-people', 'decide-dispatch'],
    };
  }
  if (phaseKey === 'orgAssigned' && identityId === 'intake-a') {
    return {
      dispatchHttp: 200,
      text: ['承办机构'],
      absentText: ['派出承办人'],
      roles: { assigned: '', 'assign-org': '重新分派' },
      absentRoles: ['assign-people', 'decide-dispatch'],
    };
  }
  throw new Error(`缺少断言 ${phaseKey} ${identityId}`);
}

const steps = [];
function record(stepId, pass, expected, actual, evidence) {
  const row = { scenarioId: SCENARIO_ID, stepId, pass, expected, actual, evidence };
  steps.push(row);
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'steps', `${stepId}.json`), JSON.stringify(row, null, 2));
  console.log(JSON.stringify({ stepId, pass }));
}

async function main() {
  const browser = await chromium.launch({ headless: !HEADED });
  let failed = false;
  try {
    for (const person of PEOPLE) {
      const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        locale: 'zh-CN',
        viewport: { width: 1440, height: 900 },
        recordVideo: { dir: path.join(EVIDENCE_DIR, 'evidence'), size: { width: 1440, height: 900 } },
      });
      await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
      const page = await context.newPage();
      const shot = async (name) => {
        const rel = `evidence/${name}.png`;
        await page.screenshot({ path: path.join(EVIDENCE_DIR, rel), fullPage: true });
        return rel;
      };

      async function doLogin(pw) {
        await page.goto(`${BASE_URL}/auth/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.getByRole('textbox', { name: '手机号' }).waitFor({ state: 'visible', timeout: 30000 });
        await page.getByRole('textbox', { name: '手机号' }).fill(person.mobile);
        await page.locator('input[name="password"]').fill(pw);
        await Promise.all([
          page.waitForURL((url) => !String(url).includes('/auth/login'), { timeout: 20000 }).catch(() => null),
          page.getByRole('button', { name: '登录' }).click(),
        ]);
        await page.waitForTimeout(800);
      }

      await doLogin(SEED_PASSWORD);
      if (page.url().includes('/auth/login')) await doLogin(NEW_PASSWORD);
      if (page.url().includes('/auth/password')) {
        await page.locator('input[name="newPassword"]').fill(NEW_PASSWORD);
        await page.locator('input[name="confirmPassword"]').fill(NEW_PASSWORD);
        await Promise.all([
          page.waitForURL((url) => !String(url).includes('password'), { timeout: 30000 }).catch(() => null),
          page.getByRole('button', { name: '更换口令' }).click(),
        ]);
        await page.waitForTimeout(800);
      }
      const loginPass = !page.url().includes('/auth/login') && !page.url().includes('/auth/password');
      const eLogin = await shot(`${person.id}-00-login`);
      record(
        `login-${person.id}`,
        loginPass,
        { identity: person.id },
        { url: page.url(), label: person.label },
        [eLogin],
      );
      if (!loginPass) failed = true;

      await page.goto(`${BASE_URL}/workbench`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.locator('text=我的待办').first().waitFor({ state: 'visible', timeout: 30000 }).catch(() => null);
      await page.waitForTimeout(1200);
      const workbenchText = await page.locator('[data-role="workbench-todos"]').innerText().catch(() => '');
      const tableText = await page.locator('.todo-table').innerText().catch(() => '');
      const codes = {};
      for (const phase of PHASES) {
        const clue = clues[phase.key] || {};
        codes[phase.key] = {
          code: clue.code || '',
          visible: clue.code ? workbenchText.includes(clue.code) : false,
        };
      }
      const eWb = await shot(`${person.id}-01-workbench`);
      record(
        `workbench-${person.id}`,
        workbenchText.includes('我的待办'),
        { observeList: true, filterRule: 'not-asserted' },
        {
          identity: person.id,
          codes,
          hasOrgSet: tableText.includes('待派承办人'),
          hasPool: tableText.includes('待派机构'),
          hasDecide: tableText.includes('待分派决定'),
          bodySnippet: workbenchText.slice(0, 1200),
        },
        [eWb],
      );

      for (const phase of PHASES) {
        const clue = clues[phase.key] || {};
        const expect = expectOf(phase.key, person.id);
        if (!clue.id) {
          record(`${phase.stepId}-${person.id}`, false, expect, { error: 'missing clue id' }, []);
          failed = true;
          continue;
        }
        const target = `${BASE_URL}/workbench/register?step=3&clue=${encodeURIComponent(clue.id)}`;
        const responsePromise = page
          .waitForResponse(
            (response) =>
              response.url().includes(`/api/clues/${clue.id}/dispatch`) &&
              response.request().method() === 'GET',
            { timeout: 30000 },
          )
          .catch(() => null);
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
        const response = await responsePromise;
        let dispatchStatus = 0;
        let dispatchBody = {};
        if (response) {
          dispatchStatus = response.status();
          dispatchBody = await response.json().catch(() => ({}));
        }
        await page.waitForTimeout(800);
        const probe = await page.evaluate(() => {
          const text = document.body ? document.body.innerText : '';
          const roles = {};
          for (const node of document.querySelectorAll('[data-role]')) {
            const role = node.getAttribute('data-role');
            if (!role || roles[role]) continue;
            roles[role] = (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
          }
          return { text, roles };
        });
        const problems = [];
        if (dispatchStatus !== expect.dispatchHttp) problems.push(`http ${dispatchStatus}`);
        if (expect.reason && dispatchBody.reason !== expect.reason) problems.push(`reason ${dispatchBody.reason || ''}`);
        for (const snippet of expect.text) {
          if (!probe.text.includes(snippet)) problems.push(`missing text ${snippet}`);
        }
        for (const snippet of expect.absentText) {
          if (probe.text.includes(snippet)) problems.push(`unexpected text ${snippet}`);
        }
        for (const [role, label] of Object.entries(expect.roles)) {
          if (!(role in probe.roles)) problems.push(`missing role ${role}`);
          else if (label && !probe.roles[role].includes(label)) problems.push(`role ${role} text ${probe.roles[role]}`);
        }
        for (const role of expect.absentRoles) {
          if (role in probe.roles) problems.push(`unexpected role ${role}`);
        }
        const pass = problems.length === 0;
        if (!pass) failed = true;
        const e = await shot(`${person.id}-02-${phase.key}`);
        record(
          `${phase.stepId}-${person.id}`,
          pass,
          {
            identity: person.id,
            status: phase.status,
            path: '/workbench/register?step=3&clue=:id',
            baseline: expect.baseline || null,
            dispatchHttp: expect.dispatchHttp,
            roles: expect.roles,
            absentRoles: expect.absentRoles,
          },
          {
            url: page.url(),
            problems,
            dispatchStatus,
            reason: dispatchBody.reason || null,
            mayDecide: dispatchBody.mayDecide === true,
            mayAssignOrg: dispatchBody.mayAssignOrg === true,
            mayAssignPeople: dispatchBody.mayAssignPeople === true,
            mayReassignOrg: dispatchBody.mayReassignOrg === true,
            roles: probe.roles,
            bodySnippet: probe.text.slice(0, 800),
          },
          [e],
        );
      }

      await context.tracing.stop({
        path: path.join(EVIDENCE_DIR, 'evidence', `trace-${person.id}.zip`),
      });
      await context.close();
    }
  } catch (err) {
    failed = true;
    record('harness-error', false, { ok: true }, { error: String((err && err.stack) || err) }, []);
  }
  await browser.close();
  const summary = {
    status: failed ? 'failed' : 'passed',
    failed: steps.filter((row) => !row.pass).map((row) => row.stepId),
    mode: HEADED ? 'headed' : 'headless',
    baseUrl: BASE_URL,
    preFixBaseline: 'intake-st dispatch 403 scope-denied',
  };
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
