export interface LoginVerdict {
  readonly ok: boolean;
  readonly blocked: boolean;
  readonly reason: 'accepted' | 'source-limited' | 'auth-rejected';
  readonly status: number;
}

export interface LoginResponseLike {
  url(): string;
  status(): number;
  text(): Promise<string>;
  request(): { method(): string };
}

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

export class AuthGateError extends Error {
  readonly code: 'AUTH_GATE_BLOCKED';
  readonly reason: string;
  readonly httpStatus: number | null;
  readonly detail: string;
  constructor(reason: string, status: number | null, detail: string);
}

export function classifyLogin(status: number, body: unknown): LoginVerdict;
export function assertLoginAccepted(status: number, body: unknown): LoginVerdict;
export function assertNoSourceOverride(headers: Record<string, string> | undefined | null): void;
export function loginPassword(seedPassword: string): string;
export function isAuthGateError(error: unknown): boolean;
export function isSourceLimited(body: unknown): boolean;
export function summaryStatus(
  requested: 'passed' | 'failed' | 'blocked',
  failedCount: number,
): 'passed' | 'failed' | 'blocked';
export function bindLoginWatch(page: LoginPageLike): {
  take(): Promise<{ status: number; bodyText: string }>;
};
export function loginPageOnce(
  page: LoginPageLike,
  baseUrl: string,
  mobile: string,
  password: string,
): Promise<void>;
export function changePasswordOnce(page: LoginPageLike, newPassword: string): Promise<void>;
