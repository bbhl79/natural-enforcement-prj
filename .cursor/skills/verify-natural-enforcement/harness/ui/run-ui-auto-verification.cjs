#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
// 自动核查四条夹具的 headless 页面取证。
// 不打开有头窗口。截图、video、trace 写到 EVIDENCE_DIR。
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = (process.env.BASE_URL || 'https://host.docker.internal:8080').replace(/\/$/, '');
const EVIDENCE_DIR = process.env.EVIDENCE_DIR;
const ONLY = process.env.VERIFY_UI_ONLY || 'all';
const SEED_PASSWORD = process.env.SEED_PASSWORD || 'Seed-pass-52';
const NEW_PASSWORD = process.env.VERIFY_NEW_PASSWORD || 'Verify-skill-loop-52!';
const CLERK_MOBILE = '13800001002';
const INTAKE_MOBILE = '13900002001';

if (!EVIDENCE_DIR) {
  console.error('EVIDENCE_DIR required');
  process.exit(2);
}
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const manifest = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, 'clue-manifest.json'), 'utf8'));
const steps = [];

function record(scenarioId, stepId, pass, expected, actual, evidence = []) {
  const row = { scenarioId, stepId, pass, expected, actual, evidence };
  steps.push(row);
  const dir = path.join(EVIDENCE_DIR, 'steps');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${scenarioId}-${stepId}.json`), JSON.stringify(row, null, 2));
  console.log(JSON.stringify({ scenarioId, stepId, pass }));
}

async function shot(page, scenarioId, name) {
  const dir = path.join(EVIDENCE_DIR, scenarioId);
  fs.mkdirSync(dir, { recursive: true });
  const rel = `${scenarioId}/${name}.png`;
  await page.screenshot({ path: path.join(EVIDENCE_DIR, rel), fullPage: true });
  return rel;
}

async function login(page, mobile) {
  async function once(password) {
    await page.goto(`${BASE_URL}/auth/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByRole('textbox', { name: '手机号' }).waitFor({ state: 'visible', timeout: 30000 });
    await page.getByRole('textbox', { name: '手机号' }).fill(mobile);
    await page.locator('input[name="password"]').fill(password);
    await Promise.all([
      page.waitForURL((url) => !String(url).includes('/auth/login'), { timeout: 20000 }).catch(() => null),
      page.getByRole('button', { name: '登录' }).click(),
    ]);
    await page.waitForTimeout(600);
  }
  await once(SEED_PASSWORD);
  if (page.url().includes('/auth/login')) await once(NEW_PASSWORD);
  if (page.url().includes('/auth/password')) {
    await page.locator('input[name="newPassword"]').fill(NEW_PASSWORD);
    await page.locator('input[name="confirmPassword"]').fill(NEW_PASSWORD);
    await Promise.all([
      page.waitForURL((url) => !String(url).includes('password'), { timeout: 30000 }).catch(() => null),
      page.getByRole('button', { name: '更换口令' }).click(),
    ]);
    await page.waitForTimeout(600);
  }
  return !page.url().includes('/auth/login') && !page.url().includes('/auth/password');
}

async function openWorkbench(page, step, clueId) {
  await page.goto(`${BASE_URL}/workbench?step=${step}&clue=${encodeURIComponent(clueId)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.locator('.card').first().waitFor({ state: 'visible', timeout: 30000 }).catch(() => null);
  await page.waitForTimeout(500);
}

async function bodyText(page) {
  return page.locator('body').innerText().catch(() => '');
}

function includesAll(text, needles) {
  return needles.filter((item) => !text.includes(item));
}

async function saveDownload(page, clueId, kind, scenarioId) {
  const response = await page.request.get(`${BASE_URL}/api/clues/${clueId}/verification/${kind}`);
  const text = await response.text();
  const rel = `${scenarioId}/${kind}.json`;
  fs.mkdirSync(path.join(EVIDENCE_DIR, scenarioId), { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, rel), text.slice(0, 20000));
  return { status: response.status(), bytes: text.length, rel };
}

async function runCase(browser, scenarioId, mobile, visit) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    locale: 'zh-CN',
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: path.join(EVIDENCE_DIR, scenarioId), size: { width: 1440, height: 900 } },
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  const page = await context.newPage();
  const httpLog = [];
  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/api/clues/') && (url.includes('verification') || url.includes('duplicates') || url.includes('dispatch'))) {
      httpLog.push({ url, status: response.status() });
    }
  });
  let failed = false;
  try {
    const loggedIn = await login(page, mobile);
    const loginShot = await shot(page, scenarioId, '00-login');
    record(scenarioId, 'login', loggedIn, { leaveLogin: true }, { url: page.url(), mobile }, [loginShot]);
    if (!loggedIn) {
      failed = true;
    } else {
      failed = (await visit(page, scenarioId)) || failed;
    }
  } catch (error) {
    failed = true;
    record(scenarioId, 'exception', false, { ok: true }, { error: String(error) }, []);
  }
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, scenarioId, 'http.json'),
    JSON.stringify(httpLog, null, 2),
  );
  const traceRel = `${scenarioId}/trace.zip`;
  await context.tracing.stop({ path: path.join(EVIDENCE_DIR, traceRel) });
  await context.close();
  return failed;
}

async function main() {
  if (process.env.HEADED === '1' || process.env.PW_HEADED === '1') {
    console.log(JSON.stringify({ headedIgnored: true, reason: '本脚本只跑 headless' }));
  }
  const browser = await chromium.launch({ headless: true });
  let failed = false;
  const clues = manifest.clues || {};
  try {
    if (ONLY === 'failure' || ONLY === 'all') {
      const clue = clues.failure;
      if (!clue?.clueId) {
        record('failure', 'missing-clue', false, { clueId: 'required' }, { clue }, []);
        failed = true;
      } else {
        failed =
          (await runCase(browser, 'failure', CLERK_MOBILE, async (page, scenarioId) => {
            await openWorkbench(page, 2, clue.clueId);
            const text = await bodyText(page);
            const missing = includesAll(text, ['没跑成', '查不成', '线索照常可以分派', '手动重跑', '永久基本农田']);
            const picture = await shot(page, scenarioId, '01-step2');
            record(
              scenarioId,
              'step2',
              missing.length === 0,
              { texts: ['没跑成', '查不成', '线索照常可以分派', '手动重跑', '永久基本农田'] },
              { missing, snippet: text.slice(0, 600) },
              [picture],
            );
            await openWorkbench(page, 3, clue.clueId);
            const step3 = await bodyText(page);
            const assigned = step3.includes('承办机构');
            const picture3 = await shot(page, scenarioId, '02-step3');
            record(
              scenarioId,
              'step3',
              assigned,
              { text: '承办机构' },
              { assigned, snippet: step3.slice(0, 600) },
              [picture3],
            );
            return missing.length > 0 || !assigned;
          })) || failed;
      }
    }

    if (ONLY === 'mineral' || ONLY === 'all') {
      const mineral = clues.mineral;
      if (!mineral?.clueId) {
        record('mineral', 'missing-clue', false, { clueId: 'required' }, { mineral }, []);
        failed = true;
      } else {
        failed =
          (await runCase(browser, 'mineral', CLERK_MOBILE, async (page, scenarioId) => {
            await openWorkbench(page, 2, mineral.clueId);
            const text = await bodyText(page);
            const missing = includesAll(text, ['已完成', '有相交', '100.0%', '下载核查报告', '下载分析图']);
            const picture = await shot(page, scenarioId, '01-step2');
            const report = await saveDownload(page, mineral.clueId, 'report', scenarioId);
            const analysis = await saveDownload(page, mineral.clueId, 'analysis', scenarioId);
            const downloadsOk = report.status === 200 && analysis.status === 200;
            record(
              scenarioId,
              'step2',
              missing.length === 0 && downloadsOk,
              { texts: ['已完成', '有相交', '100.0%', '下载核查报告', '下载分析图'], domain: 'mineral' },
              { missing, report, analysis, snippet: text.slice(0, 500) },
              [picture, report.rel, analysis.rel],
            );
            return missing.length > 0 || !downloadsOk;
          })) || failed;
      }
    }

    if (ONLY === 'layers' || ONLY === 'all') {
      const success = clues.success;
      if (!success?.clueId) {
        record('success', 'missing-clue', false, { clueId: 'required' }, { success }, []);
        failed = true;
      } else {
        failed =
          (await runCase(browser, 'success', CLERK_MOBILE, async (page, scenarioId) => {
            await openWorkbench(page, 2, success.clueId);
            const text = await bodyText(page);
            const missing = includesAll(text, ['已完成', '有相交', '100.0%', '下载核查报告', '下载分析图']);
            const picture = await shot(page, scenarioId, '01-step2');
            const report = await saveDownload(page, success.clueId, 'report', scenarioId);
            const analysis = await saveDownload(page, success.clueId, 'analysis', scenarioId);
            const downloadsOk = report.status === 200 && analysis.status === 200 && analysis.bytes > 0;
            record(
              scenarioId,
              'step2',
              missing.length === 0 && downloadsOk,
              { texts: ['已完成', '有相交', '100.0%', '下载核查报告', '下载分析图'], downloads: 200 },
              { missing, report, analysis, snippet: text.slice(0, 500) },
              [picture, report.rel, analysis.rel],
            );
            await openWorkbench(page, 3, success.clueId);
            const step3 = await bodyText(page);
            const pool = step3.includes('待分派池的线索由本机构内勤派出');
            const picture3 = await shot(page, scenarioId, '02-step3-clerk');
            record(scenarioId, 'step3-clerk', pool, { text: '待分派池的线索由本机构内勤派出' }, { pool }, [picture3]);
            await page.goto(
              `${BASE_URL}/clue?view=all&clue=${encodeURIComponent(success.clueId)}&tab=duplicate`,
              { waitUntil: 'domcontentloaded', timeout: 60000 },
            );
            await page.waitForTimeout(800);
            const dup = await bodyText(page);
            const clean = dup.includes('没有疑似重复') || dup.includes('未发现疑似重复');
            const pictureDup = await shot(page, scenarioId, '03-duplicate-tab');
            record(scenarioId, 'duplicate-tab', clean, { text: '没有疑似重复或未发现疑似重复' }, { clean }, [pictureDup]);
            return missing.length > 0 || !downloadsOk || !pool || !clean;
          })) || failed;
        failed =
          (await runCase(browser, 'success-intake', INTAKE_MOBILE, async (page, scenarioId) => {
            await openWorkbench(page, 3, success.clueId);
            const panel = await page.locator('[data-role="assign-org-panel"]').first().isVisible().catch(() => false);
            const picture = await shot(page, scenarioId, '01-step3-intake');
            record(scenarioId, 'assign-panel', panel, { role: 'assign-org-panel' }, { panel }, [picture]);
            await page.goto(`${BASE_URL}/workbench`, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.waitForTimeout(1000);
            const board = await bodyText(page);
            const todo = board.includes('待派机构');
            const pictureBoard = await shot(page, scenarioId, '02-workbench');
            record(scenarioId, 'todo', todo, { text: '待派机构' }, { todo, snippet: board.slice(0, 500) }, [pictureBoard]);
            return !panel || !todo;
          })) || failed;
      }

      const partial = clues.partial;
      if (!partial?.clueId) {
        record('partial', 'missing-clue', false, { clueId: 'required' }, { partial }, []);
        failed = true;
      } else {
        failed =
          (await runCase(browser, 'partial', CLERK_MOBILE, async (page, scenarioId) => {
            await openWorkbench(page, 2, partial.clueId);
            const text = await bodyText(page);
            const missing = includesAll(text, ['已完成', '有相交', '无相交', '25.0%', '下载核查报告', '下载分析图']);
            const picture = await shot(page, scenarioId, '01-step2');
            const report = await saveDownload(page, partial.clueId, 'report', scenarioId);
            record(
              scenarioId,
              'step2',
              missing.length === 0 && report.status === 200,
              { texts: ['已完成', '有相交', '无相交', '25.0%'] },
              { missing, reportStatus: report.status, snippet: text.slice(0, 700) },
              [picture, report.rel],
            );
            return missing.length > 0 || report.status !== 200;
          })) || failed;
      }

      const duplicate = clues.duplicate;
      if (!duplicate?.clueId) {
        record('duplicate', 'missing-clue', false, { clueId: 'required' }, { duplicate }, []);
        failed = true;
      } else {
        failed =
          (await runCase(browser, 'duplicate', CLERK_MOBILE, async (page, scenarioId) => {
            await openWorkbench(page, 2, duplicate.clueId);
            const step2 = await bodyText(page);
            const done = step2.includes('已完成') && step2.includes('下载核查报告') && step2.includes('下载分析图');
            const picture2 = await shot(page, scenarioId, '01-step2');
            record(scenarioId, 'step2', done, { texts: ['已完成', '下载核查报告', '下载分析图'] }, { done }, [picture2]);
            await openWorkbench(page, 3, duplicate.clueId);
            const step3 = await bodyText(page);
            const hit = step3.includes('占本线索') && step3.includes('疑似重复');
            const decide = await page.locator('[data-role="decide-panel"]').first().isVisible().catch(() => false);
            const picture3 = await shot(page, scenarioId, '02-step3');
            record(scenarioId, 'step3', hit && decide, { texts: ['占本线索', '疑似重复'], role: 'decide-panel' }, { hit, decide }, [picture3]);
            await page.goto(
              `${BASE_URL}/clue?view=all&clue=${encodeURIComponent(duplicate.clueId)}&tab=duplicate`,
              { waitUntil: 'domcontentloaded', timeout: 60000 },
            );
            await page.waitForTimeout(800);
            const tab = await bodyText(page);
            const tabHit = tab.includes('疑似重复') && tab.includes('占本线索');
            const pictureTab = await shot(page, scenarioId, '03-duplicate-tab');
            record(scenarioId, 'duplicate-tab', tabHit, { texts: ['疑似重复', '占本线索'] }, { tabHit }, [pictureTab]);
            await page.goto(`${BASE_URL}/workbench`, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.waitForTimeout(1000);
            const board = await bodyText(page);
            const todo = board.includes('待分派决定');
            const pictureBoard = await shot(page, scenarioId, '04-workbench');
            record(scenarioId, 'todo', todo, { text: '待分派决定' }, { todo }, [pictureBoard]);
            return !done || !hit || !decide || !tabHit || !todo;
          })) || failed;
      }
    }
  } finally {
    await browser.close();
  }
  const summary = { status: failed ? 'failed' : 'passed', only: ONLY, steps: steps.length };
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
