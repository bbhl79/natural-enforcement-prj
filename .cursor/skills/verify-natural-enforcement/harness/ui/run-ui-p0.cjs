#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Verification UI P0 (headless default): login → workbench/register field-level.
 * UI_SUBMIT=1：按验证夹具全量登记两条重合矿产面，目标必须 pending_decision。
 * Env:
 *   BASE_URL   default https://host.docker.internal:8080
 *   EVIDENCE_DIR  required (mapped to .run/verify-<id>/)
 *   SEED_PASSWORD  default Seed-pass-52
 *   HEADED / PW_HEADED =1 → headed (needs DISPLAY)
 *   UI_FILL=1 → also select source/domain and fill narrative if present
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = (process.env.BASE_URL || 'https://host.docker.internal:8080').replace(/\/$/, '');
const EVIDENCE_DIR = process.env.EVIDENCE_DIR;
const SEED_PASSWORD = process.env.SEED_PASSWORD || 'Seed-pass-52';
const NEW_PASSWORD = process.env.VERIFY_NEW_PASSWORD || 'Verify-skill-loop-52!';
const HEADED = process.env.HEADED === '1' || process.env.PW_HEADED === '1' || process.argv.includes('--headed');
const UI_FILL = process.env.UI_FILL === '1';
const UI_SUBMIT = process.env.UI_SUBMIT === '1';
let registration = null;
const SCENARIO_ID = process.env.UI_SCENARIO_ID || 'vf-sc-verify-loop-ui-login-register';
const MOBILE = process.env.VERIFY_MOBILE || '13800001002'; // clerk-a

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
    // --- login ---
    await page.goto(`${BASE_URL}/auth/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByRole('textbox', { name: '手机号' }).waitFor({ state: 'visible', timeout: 30000 });
    const eLogin = await shot('01-login');
    const phone = page.getByRole('textbox', { name: '手机号' });
    const password = page.locator('input[name="password"]');
    const submit = page.getByRole('button', { name: '登录' });
    const loginVisible = await phone.isVisible() && await password.isVisible() && await submit.isVisible();
    record('login-fields', loginVisible, { selectors: ['aria-label=手机号', 'aria-label=密码', 'button:登录'] }, { visible: loginVisible }, [eLogin]);
    if (!loginVisible) failed = true;

    async function doLogin(pw) {
      await page.goto(`${BASE_URL}/auth/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.getByRole('textbox', { name: '手机号' }).waitFor({ state: 'visible', timeout: 30000 });
      await page.getByRole('textbox', { name: '手机号' }).fill(MOBILE);
      await page.locator('input[name="password"]').fill(pw);
      await Promise.all([
        page.waitForURL((url) => !String(url).includes('/auth/login') || String(url).includes('password'), { timeout: 20000 }).catch(() => null),
        page.getByRole('button', { name: '登录' }).click(),
      ]);
      await page.waitForTimeout(800);
      return page.url();
    }

    let afterLogin = await doLogin(SEED_PASSWORD);
    if (afterLogin.includes('/auth/login')) {
      // seed may already have been rotated on this DB
      afterLogin = await doLogin(NEW_PASSWORD);
    }
    const eAfterLogin = await shot('02-after-login');
    record('login-submit', !afterLogin.includes('/auth/login') || afterLogin.includes('password'), {
      leaveLogin: true,
    }, { url: afterLogin }, [eAfterLogin]);
    if (afterLogin.includes('/auth/login') && !afterLogin.includes('password')) {
      failed = true;
    }

    // force password change? (#292: first-login only new+confirm, no current)
    if (page.url().includes('/auth/password') || /\/password(\?|$)/.test(page.url()) || page.url().includes('/account/password')) {
      const ePw = await shot('02b-password-change');
      await page.locator('input[name="newPassword"]').fill(NEW_PASSWORD);
      await page.locator('input[name="confirmPassword"]').fill(NEW_PASSWORD);
      const btn = page.getByRole('button', { name: '更换口令' });
      await Promise.all([
        page.waitForURL((url) => !String(url).includes('password'), { timeout: 30000 }).catch(() => null),
        btn.click(),
      ]);
      await page.waitForTimeout(800);
      record('password-change', !page.url().includes('password'), { button: '更换口令' }, { url: page.url() }, [ePw]);
      if (page.url().includes('password')) failed = true;
    }

    await page.goto(`${BASE_URL}/workbench/register`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (page.url().includes('/auth/login')) {
      await doLogin(NEW_PASSWORD);
      await page.goto(`${BASE_URL}/workbench/register`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }

    await page.locator('#clue-source').waitFor({ state: 'visible', timeout: 30000 });
    const eReg = await shot('03-register-shell');
    const source = page.locator('#clue-source');
    const domain = page.locator('#clue-domain');
    const saveBtn = page.locator('button[type="submit"].btn-primary');
    const sourceOk = await source.count() > 0 && await source.isVisible();
    const domainOk = await domain.count() > 0 && await domain.isVisible();
    const saveOk = await saveBtn.count() > 0 && await saveBtn.isVisible();
    const regPass = sourceOk && domainOk && saveOk && page.url().includes('/workbench/register');
    record('register-shell-fields', regPass, {
      ids: ['#clue-source', '#clue-domain'],
      submit: 'button[type=submit].btn-primary 保存',
      path: '/workbench/register',
    }, { sourceOk, domainOk, saveOk, url: page.url() }, [eReg]);
    if (!regPass) failed = true;

    if (UI_FILL && !UI_SUBMIT && regPass) {
      await source.selectOption({ value: '16' }).catch(async () => {
        await source.selectOption({ label: /巡查|16/ }).catch(() => {});
      });
      await domain.selectOption({ value: 'land' }).catch(async () => {
        await domain.selectOption({ label: /土地/ }).catch(() => {});
      });
      await page.waitForTimeout(1200);
      const narrative = page.locator('#clue-clue-narrative, textarea[name="clue.narrative"], textarea').first();
      if (await narrative.count()) {
        await narrative.fill('vf-巡查发现当事人擅自占地硬底化，约100平方米');
      }
      const eFill = await shot('04-register-filled');
      record('register-fill-source-domain', true, { sourceCode: '16', domain: 'land' }, {
        source: await source.inputValue().catch(() => null),
        domain: await domain.inputValue().catch(() => null),
      }, [eFill]);
    }

    if (UI_SUBMIT) {
      const assert = require('node:assert/strict');
      const { registerFull } = require('./register-full.cjs');
      const fixture = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, 'register-full-input.json'), 'utf8'));
      assert.equal(MOBILE, fixture.mobile, '全量登记需使用夹具指定的池所属机构内勤');
      fixture.runKey = require('node:crypto').randomUUID();
      const peer = await registerFull({ page, baseUrl: BASE_URL, fixture, record, shot, suffix: 'peer' });
      registration = await registerFull({ page, baseUrl: BASE_URL, fixture, record, shot, suffix: 'target' });
      assert.equal(registration.status, 'pending_decision', '重合矿产面必须进入待分派决定');
      assert.ok(registration.hits.some((hit) => hit.otherClueId === peer.id), '必须命中本轮UI创建的peer');
      record('registration-pending-decision', true, { status: 'pending_decision', peerId: peer.id }, { clueId: registration.id, peerId: peer.id, status: registration.status, hits: registration.hits });
    }

    await context.tracing.stop({ path: path.join(EVIDENCE_DIR, 'evidence', 'trace.zip') });
  } catch (err) {
    failed = true;
    const e = await shot('error').catch(() => null);
    record('harness-error', false, { ok: true }, { error: String(err && err.stack || err) }, e ? [e] : []);
    try { await context.tracing.stop({ path: path.join(EVIDENCE_DIR, 'evidence', 'trace.zip') }); } catch {}
  }

  await context.close();
  await browser.close();

  const summary = {
    status: failed ? 'failed' : 'passed',
    failed: steps.filter((s) => !s.pass).map((s) => `${SCENARIO_ID}/${s.stepId}`),
    runDir: EVIDENCE_DIR,
    mode: HEADED ? 'headed' : 'headless',
    baseUrl: BASE_URL,
    fullSubmit: UI_SUBMIT,
    registration,
  };
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'manifest.json'), JSON.stringify({
    runId: path.basename(EVIDENCE_DIR).replace(/^verify-/, ''),
    environment: 'verify-local-ui',
    mode: summary.mode,
    scenarios: [SCENARIO_ID],
    driver: 'playwright-docker',
  }, null, 2));
  console.log(JSON.stringify(summary));
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
