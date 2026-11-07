import type { IdentityFixture } from './load-fixtures.ts';
import { resolveSeedPassword } from './load-fixtures.ts';

const NEW_PASSWORD = 'Verify-skill-loop-52!';

function sessionCookie(response: Response): string {
  const found = response.headers.getSetCookie().find((item) => item.startsWith('__Host-sid='));
  const pair = found?.split(';')[0];
  if (!pair) throw new Error('缺少会话 Cookie');
  return pair;
}

/** 按身份夹具登录并强制改密；同 mobile 复用 Cookie。 */
export class SessionCache {
  private readonly cookies = new Map<string, string>();

  constructor(private readonly baseUrl: string) {}

  async cookieOf(identity: IdentityFixture): Promise<string> {
    const known = this.cookies.get(identity.id);
    if (known) return known;

    const seedPassword = resolveSeedPassword(identity);
    const login = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mobilePhone: identity.mobile,
        password: seedPassword,
        rememberMe: false,
      }),
    });
    if (login.status !== 200) {
      // 持久开发库上，上一跑次已经把种子口令换成验证口令。再用验证口令登录，不再改密。
      const extras = (process.env.VERIFY_EXTRA_PASSWORDS ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      let reused: string | null = null;
      for (const password of [NEW_PASSWORD, ...extras]) {
        const again = await fetch(`${this.baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            mobilePhone: identity.mobile,
            password,
            rememberMe: false,
          }),
        });
        if (again.status !== 200) continue;
        reused = sessionCookie(again);
        break;
      }
      if (reused === null) {
        throw new Error(`登录失败 ${identity.id}: HTTP ${login.status}`);
      }
      this.cookies.set(identity.id, reused);
      return reused;
    }
    const cookie = sessionCookie(login);
    const changed = await fetch(`${this.baseUrl}/api/auth/password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ currentPassword: seedPassword, newPassword: NEW_PASSWORD }),
    });
    if (changed.status !== 200) {
      throw new Error(`改密失败 ${identity.id}: HTTP ${changed.status}`);
    }
    this.cookies.set(identity.id, cookie);
    return cookie;
  }
}
