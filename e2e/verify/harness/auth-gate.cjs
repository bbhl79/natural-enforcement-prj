// 用途：认证门禁：分类登录响应、拦截来源改写，并提供页面登录与改密步骤。
// 用法：API 与 UI 脚本经 CommonJS 导出调用；页面函数接收 Playwright page 对象。
'use strict';

const SOURCE_MARKERS = ['login.source-limited', 'source-limited', '来源受限'];

/** 认证门禁错误：带 reason、HTTP 状态与截断正文，code 固定 AUTH_GATE_BLOCKED。 */
class AuthGateError extends Error {
  /**
   * @param {string} reason
   * @param {number | null} status
   * @param {string} detail
   */
  constructor(reason, status, detail) {
    const http = status == null ? 'none' : String(status);
    super(`认证门禁停止。原因 ${reason}。HTTP ${http}。`);
    this.name = 'AuthGateError';
    this.code = 'AUTH_GATE_BLOCKED';
    this.reason = reason;
    this.httpStatus = status == null ? null : status;
    this.detail = detail == null ? '' : String(detail).slice(0, 300);
  }
}

// 把任意响应体转成文本；对象走 JSON，转换失败返回空串。
function bodyText(body) {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  try {
    return JSON.stringify(body);
  } catch {
    return '';
  }
}

// 响应文本含来源受限标记时返回 true。
function isSourceLimited(body) {
  const text = bodyText(body);
  return SOURCE_MARKERS.some((marker) => text.includes(marker));
}

/** 登录响应分类。非 200 一律 blocked。产品把来源受限收成与口令错误相同的 401。 */
function classifyLogin(status, body) {
  if (isSourceLimited(body)) {
    return { ok: false, blocked: true, reason: 'source-limited', status };
  }
  if (status !== 200) {
    return { ok: false, blocked: true, reason: 'auth-rejected', status };
  }
  return { ok: true, blocked: false, reason: 'accepted', status };
}

// 登录未通过时抛 AuthGateError；通过时返回分类结果。
function assertLoginAccepted(status, body) {
  const verdict = classifyLogin(status, body);
  if (!verdict.ok) throw new AuthGateError(verdict.reason, status, bodyText(body));
  return verdict;
}

// 请求头含 x-forwarded-for 时抛 source-switch，禁止验证跑改写来源地址。
function assertNoSourceOverride(headers) {
  if (headers == null) return;
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === 'x-forwarded-for') {
      throw new AuthGateError('source-switch', null, '验证跑禁止改写来源地址');
    }
  }
}

// 优先用 VERIFY_LOGIN_PASSWORD；未设置时回落到夹具种子口令。
function loginPassword(seedPassword) {
  const explicit = process.env.VERIFY_LOGIN_PASSWORD;
  if (typeof explicit === 'string' && explicit.trim() !== '') return explicit;
  return seedPassword;
}

// 按 code 判断错误是否来自认证门禁，不依赖 instanceof。
function isAuthGateError(error) {
  return Boolean(error) && typeof error === 'object' && error.code === 'AUTH_GATE_BLOCKED';
}

// 合并请求状态与失败数：blocked 优先，其次 failed，否则沿用请求状态。
function summaryStatus(requested, failedCount) {
  if (requested === 'blocked') return 'blocked';
  if (failedCount > 0) return 'failed';
  return requested;
}

// 监听页面登录响应并暂存正文；take() 时分类判定，未见响应即视为拒绝。
function bindLoginWatch(page) {
  let pending = null;
  const onResponse = (response) => {
    let method = '';
    try {
      method = response.request().method();
    } catch {
      method = '';
    }
    if (method !== 'POST') return;
    const url = typeof response.url === 'function' ? response.url() : '';
    if (!url.includes('/api/auth/login')) return;
    const status = response.status();
    pending = response.text().then(
      (text) => ({ status, bodyText: text }),
      () => ({ status, bodyText: '' }),
    );
  };
  page.on('response', onResponse);
  return {
    async take() {
      page.off('response', onResponse);
      const seen = pending == null ? null : await pending;
      if (seen == null) throw new AuthGateError('auth-rejected', null, '未见登录响应');
      assertLoginAccepted(seen.status, seen.bodyText);
      return seen;
    },
  };
}

// 用手机号与口令走一次页面登录；失败抛 AuthGateError，成功停在内页或改密页。
async function loginPageOnce(page, baseUrl, mobile, password) {
  const watch = bindLoginWatch(page);
  const root = String(baseUrl).replace(/\/$/, '');
  await page.goto(`${root}/auth/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByRole('textbox', { name: '手机号' }).waitFor({ state: 'visible', timeout: 30000 });
  await page.getByRole('textbox', { name: '手机号' }).fill(mobile);
  await page.locator('input[name="password"]').fill(password);
  await Promise.all([
    page
      .waitForURL(
        (url) => !String(url).includes('/auth/login') || String(url).includes('password'),
        { timeout: 20000 },
      )
      .catch(() => null),
    page.getByRole('button', { name: '登录' }).click(),
  ]);
  await page.waitForTimeout(800);
  await watch.take();
  const current = String(page.url());
  if (current.includes('/auth/login') && !current.includes('/auth/password')) {
    throw new AuthGateError('auth-rejected', null, '登录后仍停在登录页');
  }
}

// 当前在改密页时填入新口令并提交；未离开改密页则抛 AuthGateError。
async function changePasswordOnce(page, newPassword) {
  const current = String(page.url());
  const onPassword = current.includes('/auth/password') || current.includes('/account/password');
  if (!onPassword) return;
  await page.locator('input[name="newPassword"]').fill(newPassword);
  await page.locator('input[name="confirmPassword"]').fill(newPassword);
  await Promise.all([
    page.waitForURL((url) => !String(url).includes('password'), { timeout: 30000 }).catch(() => null),
    page.getByRole('button', { name: '更换口令' }).click(),
  ]);
  await page.waitForTimeout(800);
  if (String(page.url()).includes('password')) {
    throw new AuthGateError('auth-rejected', null, '产品要求的更换口令未完成');
  }
}

module.exports = {
  AuthGateError,
  assertLoginAccepted,
  assertNoSourceOverride,
  bindLoginWatch,
  changePasswordOnce,
  classifyLogin,
  isAuthGateError,
  isSourceLimited,
  loginPageOnce,
  loginPassword,
  summaryStatus,
};
