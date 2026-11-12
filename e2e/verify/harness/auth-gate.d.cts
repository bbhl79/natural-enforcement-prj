// 用途：声明 auth-gate.cjs 的导出类型，供 TypeScript 运行器与页面脚本调用。
/** 登录响应分类结果：是否通过、是否 blocked、原因与 HTTP 状态。 */
export interface LoginVerdict {
  readonly ok: boolean;
  readonly blocked: boolean;
  readonly reason: 'accepted' | 'source-limited' | 'auth-rejected';
  readonly status: number;
}

/** Playwright 登录响应的最小结构。 */
export interface LoginResponseLike {
  url(): string;
  status(): number;
  text(): Promise<string>;
  request(): { method(): string };
}

/** Playwright 页面在登录与改密流程中用到的子集。 */
export interface LoginPageLike {
  goto(url: string, options?: unknown): Promise<unknown>;
  url(): string;
  waitForTimeout(ms: number): Promise<unknown>;
  waitForURL(predicate: (url: URL) => boolean, options?: unknown): Promise<unknown>;
  on(event: 'response', handler: (response: LoginResponseLike) => void): void;
  off(event: 'response', handler: (response: LoginResponseLike) => void): void;
  getByRole(
    role: string,
    options?: { name?: string },
  ): {
    waitFor(options?: unknown): Promise<unknown>;
    fill(value: string): Promise<unknown>;
    click(): Promise<unknown>;
  };
  locator(selector: string): { fill(value: string): Promise<unknown> };
}

/** 认证门禁错误类型：code 固定 AUTH_GATE_BLOCKED。 */
export class AuthGateError extends Error {
  readonly code: 'AUTH_GATE_BLOCKED';
  readonly reason: string;
  readonly httpStatus: number | null;
  readonly detail: string;
  constructor(reason: string, status: number | null, detail: string);
}

/** 按响应体与状态分类登录结果；来源受限与口令错误都归 blocked。 */
export function classifyLogin(status: number, body: unknown): LoginVerdict;
/** 登录未通过时抛 AuthGateError；通过返回分类结果。 */
export function assertLoginAccepted(status: number, body: unknown): LoginVerdict;
/** 请求头含 x-forwarded-for 时抛 source-switch。 */
export function assertNoSourceOverride(headers: Record<string, string> | undefined | null): void;
/** 优先用 VERIFY_LOGIN_PASSWORD，未设置时回落到种子口令。 */
export function loginPassword(seedPassword: string): string;
/** 按 code 判断错误是否来自认证门禁。 */
export function isAuthGateError(error: unknown): boolean;
/** 响应体含来源受限标记时返回 true。 */
export function isSourceLimited(body: unknown): boolean;
/** 合并请求状态与失败数：blocked 优先，其次 failed。 */
export function summaryStatus(
  requested: 'passed' | 'failed' | 'blocked',
  failedCount: number,
): 'passed' | 'failed' | 'blocked';
/** 监听登录响应并暂存正文，take() 时分类判定。 */
export function bindLoginWatch(page: LoginPageLike): {
  take(): Promise<{ status: number; bodyText: string }>;
};
/** 用手机号与口令走一次页面登录；失败抛 AuthGateError。 */
export function loginPageOnce(
  page: LoginPageLike,
  baseUrl: string,
  mobile: string,
  password: string,
): Promise<void>;
/** 当前在改密页时填入新口令并提交；失败抛 AuthGateError。 */
export function changePasswordOnce(page: LoginPageLike, newPassword: string): Promise<void>;
