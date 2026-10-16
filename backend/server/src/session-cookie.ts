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

/** 只采信紧邻一跳写下的单个地址。带逗号的链是客户端自带的，不采信。 */
export function sourceAddress(req: {
  socket?: { remoteAddress?: string | null };
  headers?: { 'x-forwarded-for'?: string | string[] | undefined };
}): string | null {
  const header = req.headers?.['x-forwarded-for'];
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw === 'string') {
    const address = raw.trim();
    if (address !== '' && !address.includes(',')) return address;
  }
  return req.socket?.remoteAddress ?? null;
}
