#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Verification step2／step3 UI 探活（headless default）。
 * 全量登记入口 run-ui-full-loop.sh；CLUE_ID 为本轮真实UI登记所得。
 * Env:
 *   BASE_URL   default https://host.docker.internal:8080
 *   EVIDENCE_DIR  required (mapped to e2e/results/verify-<id>/)
 *   SEED_PASSWORD  default Seed-pass-52
 *   VERIFY_LOGIN_PASSWORD  可选。设置后整次只使用这一口令。
 *   CLUE_ID  点击写必填；只读时可省略。用于探测 /workbench?step=2&clue=… and step=3
 *   EXPECT_STATUS optional: pending_decision | in_pool | org_assigned | handler_assigned
 *   HEADED / PW_HEADED =1 → headed (needs DISPLAY)
 *   UI_CLICK_WRITE=1（默认）必须顺序点击 decide／assign-org；UI_CLICK_WRITE=0 只读断言
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

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
const { AuthGateError, changePasswordOnce, isAuthGateError, loginPageOnce, loginPassword } = loadAuthGate();

const BASE_URL = (process.env.BASE_URL || 'https://host.docker.internal:8080').replace(/\/$/, '');
const EVIDENCE_DIR = process.env.EVIDENCE_DIR;
const SEED_PASSWORD = process.env.SEED_PASSWORD || 'Seed-pass-52';
const NEW_PASSWORD = process.env.VERIFY_NEW_PASSWORD || 'Verify-skill-loop-52!';
const HEADED = process.env.HEADED === '1' || process.env.PW_HEADED === '1' || process.argv.includes('--headed');
const MOBILE = process.env.VERIFY_MOBILE || '13800001002'; // clerk-a
const CLUE_ID = process.env.CLUE_ID || '';
const EXPECT_STATUS = process.env.EXPECT_STATUS || '';
const CLICK_WRITE = process.env.UI_CLICK_WRITE !== '0';
const SCENARIO_ID = process.env.UI_SCENARIO_ID || 'vf-sc-verify-loop-ui-verify-dispatch';

if (!EVIDENCE_DIR) {
  console.error('EVIDENCE_DIR required');
  process.exit(2);
}
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
fs.mkdirSync(path.join(EVIDENCE_DIR, 'evidence'), { recursive: true });
fs.mkdirSync(path.join(EVIDENCE_DIR, 'steps'), { recursive: true });

const steps = [];
function record(stepId, pass, expected, actual, evidence = []) {
  const row = { scenarioId: SCENARIO_ID, stepId, pass, expected, actual, evidence };
  steps.push(row);
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'steps', `${stepId}.json`), JSON.stringify(row, null, 2));
  console.log(JSON.stringify({ stepId, pass, actual }));
}

async function main() {
  const browser = await chromium.launch({
    headless: !HEADED,
    args: HEADED ? [] : undefined,
  });
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

  let failed = false;
  let blocked = false;
  try {
    await loginPageOnce(page, BASE_URL, MOBILE, loginPassword(SEED_PASSWORD));
    await changePasswordOnce(page, NEW_PASSWORD);
    const eLogin = await shot('01-after-login');
    const loginPass = !page.url().includes('/auth/login') && !page.url().includes('/auth/password');
    record('login', loginPass, { leaveLoginOrChangePassword: true, attempts: 1 }, { url: page.url() }, [eLogin]);
    if (!loginPass) throw new AuthGateError('auth-rejected', null, '登录后仍停在登录页或更换口令页');

    if (CLUE_ID === '') {
      record('clue-context', !CLICK_WRITE, { clueId: '点击写必填' }, { clueId: null, skipped: true }, []);
      if (CLICK_WRITE) failed = true;
    } else {
      // --- step2 内业核查（字段级） ---
      await page.goto(`${BASE_URL}/workbench?step=2&clue=${encodeURIComponent(CLUE_ID)}`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      const verifyCard = page
        .locator('.card')
        .filter({ hasText: /内业核查|不设内业核查/ })
        .first();
      await verifyCard.waitFor({ state: 'visible', timeout: 30000 }).catch(() => null);
      const step2Text = await page.locator('body').innerText().catch(() => '');
      const statusLabels = ['已完成', '没跑成', '核查进行中', '不设内业核查'].filter((label) =>
        step2Text.includes(label),
      );
      const autoCopyHits = [
        '录入保存后自动发起内业核查',
        '内业核查没跑成',
        '重跑提示一直挂到跑成',
        '测绘类与规划类线索不跑内业核查',
      ].filter((text) => step2Text.includes(text));
      const verifyPass =
        (await verifyCard.isVisible().catch(() => false)) &&
        !step2Text.includes('内业核查没有加载出来') &&
        statusLabels.length > 0;
      const eStep2 = await shot('02-step2-verification');
      record(
        'verify-step2',
        verifyPass,
        {
          path: '/workbench?step=2&clue=:id',
          card: '内业核查',
          statusLabel: '任一核查状态',
          autoCopy: '自动核查文案之一',
        },
        {
          url: page.url(),
          statusLabels,
          autoCopyHits,
          bodySnippet: step2Text.slice(0, 800),
        },
        [eStep2],
      );
      if (!verifyPass) failed = true;

      // --- step3 分派决定（字段级 data-role / #dispatch-org / #dispatch-main） ---
      await page.goto(`${BASE_URL}/workbench?step=3&clue=${encodeURIComponent(CLUE_ID)}`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      const panelSelector =
        '[data-role="decide-panel"], [data-role="assign-org-panel"], [data-role="assigned"], [data-role="assign-readonly"]';
      await page
        .locator(panelSelector)
        .first()
        .waitFor({ state: 'visible', timeout: 30000 })
        .catch(() => null);
      const fieldProbe = await page.evaluate(() => {
        const roles = [];
        for (const node of document.querySelectorAll('[data-role]')) {
          roles.push(node.getAttribute('data-role'));
        }
        const uniq = [...new Set(roles)];
        const org = document.querySelector('#dispatch-org');
        const main = document.querySelector('#dispatch-main');
        const btnState = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          return {
            present: true,
            disabled: Boolean(el.disabled),
            text: (el.textContent || '').trim().slice(0, 40),
          };
        };
        return {
          roles: uniq,
          dispatchOrg: org
            ? { present: true, disabled: Boolean(org.disabled), optionCount: org.options ? org.options.length : 0 }
            : { present: false },
          dispatchMain: main
            ? { present: true, disabled: Boolean(main.disabled), optionCount: main.options ? main.options.length : 0 }
            : { present: false },
          decideHold: btnState('[data-role="decide-hold"]'),
          decideDispatch: btnState('[data-role="decide-dispatch"]'),
          assignOrg: btnState('[data-role="assign-org"]'),
          assignPeople: btnState('[data-role="assign-people"]'),
        };
      });
      const step3Text = await page.locator('body').innerText().catch(() => '');
      const fallbackTexts = [
        '待分派池的线索由本机构内勤派出',
        '分派决定由录入人完成',
        '打开一条线索后开始分派决定',
      ];
      const fallback = fallbackTexts.find((text) => step3Text.includes(text)) ?? null;
      const expectedRole = {
        pending_decision: 'decide-panel',
        in_pool: 'assign-org-panel',
        org_assigned: 'assigned',
        handler_assigned: 'assigned',
      }[EXPECT_STATUS];
      const interestingRoles = fieldProbe.roles.filter((r) =>
        /^(decide-|assign-|assigned)/.test(r || ''),
      );
      // 只读探活可接受无权限兜底；点击写必须命中实际面板。
      const panelPass = expectedRole
        ? fieldProbe.roles.includes(expectedRole) || (!CLICK_WRITE && fallback !== null)
        : interestingRoles.length > 0 || fallback !== null;
      const fieldPass = panelPass;
      const eStep3 = await shot('03-step3-dispatch');
      record(
        'dispatch-step3',
        fieldPass,
        {
          path: '/workbench?step=3&clue=:id',
          panels: [
            'decide-panel',
            'decide-hold',
            'decide-dispatch',
            'assign-org-panel',
            'assign-org',
            'assign-people-panel',
            'assign-people',
            'assign-readonly',
            'assigned',
          ],
          selectors: ['#dispatch-org', '#dispatch-main'],
          expectStatus: EXPECT_STATUS || null,
        },
        {
          url: page.url(),
          roles: fieldProbe.roles,
          interestingRoles,
          dispatchOrg: fieldProbe.dispatchOrg,
          dispatchMain: fieldProbe.dispatchMain,
          decideHold: fieldProbe.decideHold,
          decideDispatch: fieldProbe.decideDispatch,
          assignOrg: fieldProbe.assignOrg,
          assignPeople: fieldProbe.assignPeople,
          fallback,
          bodySnippet: step3Text.slice(0, 800),
        },
        [eStep3],
      );
      if (!fieldPass) failed = true;

      // 点击写必须同时完成decide和派机构；缺权限、跳过、HTTP失败均判红。
      if (CLICK_WRITE) {
        const assert = require('node:assert/strict');
        async function readView() {
          const response = await page.request.get(`${BASE_URL}/api/clues/${CLUE_ID}/dispatch`);
          assert.equal(response.status(), 200);
          return response.json();
        }
        let view = await readView();
        record('click-write-precondition', view.status === 'pending_decision' && view.mayDecide,
          { status: 'pending_decision', mayDecide: true }, { mobile: MOBILE, ...view }, [await shot('04-before-decide')]);
        assert.equal(view.status, 'pending_decision');
        assert.equal(view.mayDecide, true);
        async function clickWrite(role, endpoint, expectedStatus) {
          const button = page.locator(`[data-role="${role}"]`);
          await button.waitFor({ state: 'visible' });
          assert.equal(await button.isDisabled(), false, `${role}已禁用`);
          const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/clues/${CLUE_ID}/${endpoint}` && response.request().method() === 'POST');
          await button.click();
          const response = await responsePromise;
          const body = await response.json();
          const requestBody = response.request().postDataJSON();
          record(`click-${role}`, response.status() === 200 && body.status === expectedStatus,
            { http: 200, status: expectedStatus, control: role }, { http: response.status(), requestBody, body }, [await shot(`05-${role}`)]);
          assert.equal(response.status(), 200, JSON.stringify(body));
          assert.equal(body.status, expectedStatus);
          assert.equal(body.clueId, CLUE_ID);
          return body;
        }
        await clickWrite('decide-dispatch', 'decide', 'in_pool');
        await page.locator('#dispatch-org').waitFor({ state: 'visible' });
        view = await readView();
        record('click-write-assign-permission', view.status === 'in_pool' && view.mayAssignOrg,
          { status: 'in_pool', mayAssignOrg: true }, { mobile: MOBILE, ...view });
        assert.equal(view.status, 'in_pool');
        assert.equal(view.mayAssignOrg, true);
        const org = page.locator('#dispatch-org');
        await org.selectOption({ label: process.env.ASSIGN_ORG_NAME || '第一执法支队' });
        const selectedOrg = await org.inputValue();
        assert.ok(selectedOrg);
        await clickWrite('assign-org', 'assign-org', 'org_assigned');
        view = await readView();
        assert.equal(view.status, 'org_assigned');
        assert.equal(view.assignment.orgUnitId, selectedOrg);
        await page.locator('[data-role="assigned"]').waitFor({ state: 'visible' });
        record('click-write', true, { status: 'org_assigned', requiredWrites: ['decide-dispatch', 'assign-org'] },
          { mobile: MOBILE, clueId: CLUE_ID, status: view.status, assignment: view.assignment }, [await shot('06-after-click-write')]);
      } else {
        record('click-write', true, { readOnly: true }, { skipped: true, reason: 'UI_CLICK_WRITE=0；不代表点击写通过' }, []);
      }

      // --- E 待办：/workbench 观察 decide／pool／rerun ---
      await page.goto(`${BASE_URL}/workbench`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(1500);
      const todoProbe = await page.evaluate(() => {
        const body = document.body ? document.body.innerText : '';
        const kinds = ['待分派决定', '待派机构', '待派承办人', '重跑核查', '补齐缺件'];
        const present = kinds.filter((k) => body.includes(k));
        const rows = [];
        for (const el of document.querySelectorAll('[data-role="todo-row"], .todo-row, tr, li')) {
          const t = (el.textContent || '').trim();
          if (/待分派决定|待派机构|重跑核查|待派承办人/.test(t) && t.length < 240) {
            rows.push(t.replace(/\s+/g, ' ').slice(0, 160));
          }
        }
        return { present, sampleRows: [...new Set(rows)].slice(0, 12), bodySnippet: body.slice(0, 1000) };
      });
      const eTodo = await shot('05-workbench-todos');
      const todoPass = true; // 观察项，不因空清单判红
      record(
        'workbench-todos-E',
        todoPass,
        { observe: ['decide', 'pool', 'rerun'], labels: ['待分派决定', '待派机构', '重跑核查'] },
        todoProbe,
        [eTodo],
      );
    }

    await context.tracing.stop({ path: path.join(EVIDENCE_DIR, 'evidence', 'trace.zip') });
  } catch (err) {
    if (isAuthGateError(err)) blocked = true;
    else failed = true;
    const e = await shot('error').catch(() => null);
    record('harness-error', false, { ok: true }, { error: String((err && err.stack) || err) }, e ? [e] : []);
    try {
      await context.tracing.stop({ path: path.join(EVIDENCE_DIR, 'evidence', 'trace.zip') });
    } catch {}
  }

  await context.close();
  await browser.close();

  const summary = {
    status: blocked ? 'blocked' : failed ? 'failed' : 'passed',
    failed: steps.filter((s) => !s.pass).map((s) => `${SCENARIO_ID}/${s.stepId}`),
    runDir: EVIDENCE_DIR,
    mode: HEADED ? 'headed' : 'headless',
    baseUrl: BASE_URL,
    clueId: CLUE_ID || null,
    expectStatus: EXPECT_STATUS || null,
    clickWrite: CLICK_WRITE,
  };
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, 'manifest.json'),
    JSON.stringify(
      {
        runId: path.basename(EVIDENCE_DIR).replace(/^verify-/, ''),
        environment: 'verify-local-ui',
        mode: summary.mode,
        scenarios: [SCENARIO_ID],
        driver: 'playwright-docker',
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(summary));
  process.exit(blocked || failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
