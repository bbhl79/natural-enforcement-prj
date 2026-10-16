export const SESSION_COOKIE = '__Host-sid';

const COOKIE_ATTRS = 'HttpOnly; Secure; SameSite=Lax; Path=/';

export function serializeSessionCookie(secret: string): string {
  return `${SESSION_COOKIE}=${secret}; ${COOKIE_ATTRS}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; ${COOKIE_ATTRS}; Max-Age=0`;
}

/** 只取指定名字的那一枚。不引入 cookie 解析包。 */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    return trimmed.slice(eq + 1);
  }
  return null;
}

export function sourceAddress(req: { socket?: { remoteAddress?: string | null } }): string | null {
  return req.socket?.remoteAddress ?? null;
}
