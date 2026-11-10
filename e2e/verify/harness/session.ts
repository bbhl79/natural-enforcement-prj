import type { IdentityFixture } from './load-fixtures.ts';
import { resolveSeedPassword } from './load-fixtures.ts';
import {
  assertLoginAccepted,
  assertNoSourceOverride,
  AuthGateError,
  loginPassword,
} from './auth-gate.cjs';

const NEW_PASSWORD = 'Verify-skill-loop-52!';

function sessionCookie(response: Response): string {
  const found = response.headers.getSetCookie().find((item) => item.startsWith('__Host-sid='));
  const pair = found?.split(';')[0];
  if (!pair) throw new Error('缺少会话 Cookie');
  return pair;
}

async function readBody(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (raw === '') return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function resultOf(body: unknown): string {
  if (typeof body !== 'object' || body === null || !('result' in body)) return '';
  const result = body.result;
  return typeof result === 'string' ? result : '';
}

/** 按身份夹具登录一次。失败即停。同 mobile 只复用已成功的 Cookie。 */
export class SessionCache {
  private readonly cookies = new Map<string, string>();

  constructor(private readonly baseUrl: string) {}

  async cookieOf(identity: IdentityFixture): Promise<string> {
    const known = this.cookies.get(identity.id);
    if (known) return known;

    const headers = { 'content-type': 'application/json' };
    assertNoSourceOverride(headers);
    const password = loginPassword(resolveSeedPassword(identity));
    const login = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        mobilePhone: identity.mobile,
        password,
        rememberMe: false,
      }),
    });
    const body = await readBody(login);
    assertLoginAccepted(login.status, body);
    const cookie = sessionCookie(login);
    const result = resultOf(body);
    if (result === 'password-change-required' || result === 'password-expired') {
      const changed = await fetch(`${this.baseUrl}/api/auth/password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ currentPassword: password, newPassword: NEW_PASSWORD }),
      });
      if (changed.status !== 200) {
        const detail = await changed.text();
        throw new AuthGateError('auth-rejected', changed.status, detail);
      }
    }
    this.cookies.set(identity.id, cookie);
    return cookie;
  }
}
