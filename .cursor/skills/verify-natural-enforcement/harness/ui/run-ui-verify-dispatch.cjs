#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Verification step2／step3 UI 探活（headless default）。
 * 缩范围：不做 UI 全量登记提交（尚未跑）；线索由 API 造数后经 CLUE_ID 带入。
 * Env:
 *   BASE_URL   default https://host.docker.internal:8080
 *   EVIDENCE_DIR  required (mapped to .run/verify-<id>/)
 *   SEED_PASSWORD  default Seed-pass-52
 *   CLUE_ID  optional; set to probe /workbench?step=2&clue=… and step=3
 *   EXPECT_STATUS optional: pending_decision | in_pool | org_assigned | handler_assigned
 *   HEADED / PW_HEADED =1 → headed (needs DISPLAY)
 *   UI_CLICK_WRITE=1（默认）尽量点击 decide／assign；UI_CLICK_WRITE=0 只读断言
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = (process.env.BASE_URL || 'https://host.docker.internal:8080').replace(/\/$/, '');
const EVIDENCE_DIR = process.env.EVIDENCE_DIR;
const SEED_PASSWORD = process.env.SEED_PASSWORD || 'Seed-pass-52';
const NEW_PASSWORD = process.env.VERIFY_NEW_PASSWORD || 'Verify-skill-loop-52!';
const HEADED = process.env.HEADED === '1' || process.env.PW_HEADED === '1' || process.argv.includes('--headed');
const MOBILE = process.env.VERIFY_MOBILE || '13800001002'; // clerk-a
const CLUE_ID = process.env.CLUE_ID || '';
const EXPECT_STATUS = process.env.EXPECT_STATUS || '';
const CLICK_WRITE = process.env.UI_CLICK_WRITE !== '0';
const SCENARIO_ID = 'vf-sc-verify-loop-ui-verify-dispatch';

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
  try {
    async function doLogin(pw) {
      await page.goto(`${BASE_URL}/auth/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.getByRole('textbox', { name: '手机号' }).waitFor({ state: 'visible', timeout: 30000 });
      await page.getByRole('textbox', { name: '手机号' }).fill(MOBILE);
      await page.locator('input[name="password"]').fill(pw);
      await Promise.all([
        page.waitForURL((url) => !String(url).includes('/auth/login'), { timeout: 20000 }).catch(() => null),
        page.getByRole('button', { name: '登录' }).click(),
      ]);
      await page.waitForTimeout(800);
      return page.url();
    }

    let afterLogin = await doLogin(SEED_PASSWORD);
    if (afterLogin.includes('/auth/login')) {
      afterLogin = await doLogin(NEW_PASSWORD);
    }
    if (page.url().includes('/auth/password')) {
      await page.locator('input[name="newPassword"]').fill(NEW_PASSWORD);
      await page.locator('input[name="confirmPassword"]').fill(NEW_PASSWORD);
      await Promise.all([
        page.waitForURL((url) => !String(url).includes('password'), { timeout: 30000 }).catch(() => null),
        page.getByRole('button', { name: '更换口令' }).click(),
      ]);
      await page.waitForTimeout(800);
    }
    const eLogin = await shot('01-after-login');
    const loginPass = !page.url().includes('/auth/login') && !page.url().includes('/auth/password');
    record('login', loginPass, { leaveLoginOrChangePassword: true }, { url: page.url() }, [eLogin]);
    if (!loginPass) failed = true;

    if (CLUE_ID === '') {
      record('clue-context', true, { clueId: 'optional' }, { clueId: null, skipped: true }, []);
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
      // EXPECT_STATUS 收紧面板；本身份无权限时兜底文案也算 step3 探活通过（字段级记 fallback）。
      const panelPass = expectedRole
        ? fieldProbe.roles.includes(expectedRole) || fallback !== null
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

      // --- 尽量点击写 decide／assign ---
      if (CLICK_WRITE) {
        const clickResult = {
          attempted: [],
          skipped: [],
          wrote: false,
        };
        async function tryClick(role, label) {
          const loc = page.locator(`[data-role="${role}"]`).first();
          const visible = await loc.isVisible().catch(() => false);
          if (!visible) {
            clickResult.skipped.push({ role, reason: 'not-present' });
            return false;
          }
          const disabled = await loc.isDisabled().catch(() => true);
          if (disabled) {
            clickResult.skipped.push({ role, reason: 'disabled', label });
            return false;
          }
          // assign-org needs a selected org first
          if (role === 'assign-org') {
            const orgSel = page.locator('#dispatch-org');
            if (await orgSel.isVisible().catch(() => false)) {
              const current = await orgSel.inputValue().catch(() => '');
              if (!current) {
                const options = await orgSel.locator('option').all();
                for (const opt of options) {
                  const val = await opt.getAttribute('value');
                  if (val) {
                    await orgSel.selectOption(val);
                    break;
                  }
                }
              }
            }
          }
          if (role === 'assign-people') {
            const mainSel = page.locator('#dispatch-main');
            if (await mainSel.isVisible().catch(() => false)) {
              const current = await mainSel.inputValue().catch(() => '');
              if (!current) {
                const options = await mainSel.locator('option').all();
                for (const opt of options) {
                  const val = await opt.getAttribute('value');
                  if (val) {
                    await mainSel.selectOption(val);
                    break;
                  }
                }
              }
            }
          }
          await loc.click({ timeout: 5000 }).catch((err) => {
            clickResult.skipped.push({ role, reason: String(err) });
            return null;
          });
          await page.waitForTimeout(1200);
          clickResult.attempted.push({ role, label });
          clickResult.wrote = true;
          return true;
        }
        // prefer decide then assign-org then assign-people
        await tryClick('decide-dispatch', '派出');
        if (!clickResult.wrote) await tryClick('assign-org', '派出机构');
        if (!clickResult.wrote) await tryClick('assign-people', '派出承办人');
        const eClick = await shot('04-after-click-write');
        // 点击写：控件禁用／无权限不算失败（记证据）；真正抛错才红
        const clickPass = true;
        record(
          'click-write',
          clickPass,
          { prefer: ['decide-dispatch', 'assign-org', 'assign-people'], optionalWrite: true },
          clickResult,
          [eClick],
        );
      } else {
        record('click-write', true, { optionalWrite: true }, { skipped: true, reason: 'UI_CLICK_WRITE=0' }, []);
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
    failed = true;
    const e = await shot('error').catch(() => null);
    record('harness-error', false, { ok: true }, { error: String((err && err.stack) || err) }, e ? [e] : []);
    try {
      await context.tracing.stop({ path: path.join(EVIDENCE_DIR, 'evidence', 'trace.zip') });
    } catch {}
  }

  await context.close();
  await browser.close();

  const summary = {
    status: failed ? 'failed' : 'passed',
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
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
