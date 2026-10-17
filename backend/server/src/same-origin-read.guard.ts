// 读接口的跨站拒绝（#105 Testing「每个新接口的四条必测」第 4 条，#123）。
// 框架内建 CSRF（enableCsrfProtection，#91）对 GET/HEAD/OPTIONS 恒放行，只管写请求。
// 管理台的读接口返回数据范围内的主数据，同样不接受跨站请求。判定照框架的写法：
// 有 Sec-Fetch-Site 时只放行 same-origin 和 none；没有时看 Origin，与 Host 不同即拒绝；两者都没有视为非浏览器，放行。
// 被拒返回 403，不写留痕（与框架拒绝跨站写请求一致）。
// 用法：在读接口上 @UseGuards(SameOriginReadGuard)。全局 SessionGuard 见到这个声明，会在识别身份（openRequest）之前先做同一判定，
// 所以跨站请求不会写拒绝留痕、不会推进会话活动时间、也不会换发记住我凭据；本守卫留作第二道判定。
import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';

interface RequestHeaders {
  headers: Record<string, string | string[] | undefined>;
}

function single(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function defaultPort(protocol: string): string {
  return protocol === 'https:' ? '443' : protocol === 'http:' ? '80' : '';
}

/** Origin 与 Host 是否同源（大小写不敏感，忽略默认端口）。解析不了按跨站处理。 */
function sameHost(origin: string, host: string): boolean {
  try {
    const from = new URL(origin);
    const target = new URL(`${from.protocol}//${host}`);
    const port = (url: URL): string => url.port || defaultPort(url.protocol);
    return from.hostname === target.hostname && port(from) === port(target);
  } catch {
    return false;
  }
}

export function isCrossSiteRequest(headers: Record<string, string | string[] | undefined>): boolean {
  const site = single(headers['sec-fetch-site'])?.toLowerCase() ?? null;
  if (site !== null) return site !== 'same-origin' && site !== 'none';
  const origin = single(headers.origin);
  if (origin === null) return false;
  const host = single(headers.host);
  return host === null || !sameHost(origin, host);
}

@Injectable()
export class SameOriginReadGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RequestHeaders>();
    if (isCrossSiteRequest(req.headers)) {
      throw new HttpException({ result: 'cross-site' }, HttpStatus.FORBIDDEN);
    }
    return true;
  }
}
