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
      // --- step2 内业核查 ---
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
      const verifyPass =
        (await verifyCard.isVisible().catch(() => false)) &&
        !step2Text.includes('内业核查没有加载出来');
      const eStep2 = await shot('02-step2-verification');
      record(
        'verify-step2',
        verifyPass,
        { path: '/workbench?step=2&clue=:id', card: '内业核查', statusLabel: '任一核查状态' },
        { url: page.url(), statusLabels, bodySnippet: step2Text.slice(0, 600) },
        [eStep2],
      );
      if (!verifyPass) failed = true;

      // --- step3 分派决定 ---
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
      const roles = await page.evaluate(() => {
        const found = [];
        for (const node of document.querySelectorAll('[data-role]')) {
          found.push(node.getAttribute('data-role'));
        }
        return [...new Set(found)];
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
      const panelPass = expectedRole
        ? roles.includes(expectedRole)
        : roles.length > 0 || fallback !== null;
      const eStep3 = await shot('03-step3-dispatch');
      record(
        'dispatch-step3',
        panelPass,
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
          expectStatus: EXPECT_STATUS || null,
        },
        { url: page.url(), roles, fallback, bodySnippet: step3Text.slice(0, 600) },
        [eStep3],
      );
      if (!panelPass) failed = true;
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