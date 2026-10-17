import 'reflect-metadata';

import { HttpException, UseGuards, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import type { AuthService } from './auth.service.ts';
import { SameOriginReadGuard } from './same-origin-read.guard.ts';
import { SessionGuard } from './session.guard.ts';

// 守卫只用到 openRequest 和 passwordChangeState，换成假的；也免得单测装载口令散列等原生依赖。
vi.mock('./auth.service.ts', () => ({ AuthService: class AuthService {} }));

class Probe {
  @UseGuards(SameOriginReadGuard)
  guarded(): void {}

  plain(): void {}
}

function setup() {
  const openRequest = vi.fn(async () => ({ active: null, setCookies: [] as string[] }));
  const auth = { openRequest, passwordChangeState: () => null } as unknown as AuthService;
  return { openRequest, guard: new SessionGuard(auth, new Reflector()) };
}

function contextFor(handler: () => void, headers: Record<string, string>): ExecutionContext {
  const req = { headers, method: 'GET', path: '/api/org-units' };
  return {
    getHandler: () => handler,
    getClass: () => Probe,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({ setHeader: vi.fn() }) }),
  } as unknown as ExecutionContext;
}

async function rejection(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) return error;
    throw error;
  }
  throw new Error('应当被拒绝');
}

describe('SessionGuard：声明了 SameOriginReadGuard 的读接口（PR #142 Copilot 意见 1）', () => {
  it.each([
    ['没有凭据', {}],
    ['失效会话', { cookie: '__Host-sid=no-such-session' }],
    ['记住我凭据', { cookie: '__Host-rm=remembered-secret' }],
  ] as Array<[string, Record<string, string>]>)('跨站请求（%s）在识别身份之前被拒：403 cross-site，不调用 openRequest', async (_name, cookie) => {
    const { guard, openRequest } = setup();
    const crossSite: Array<Record<string, string>> = [{ 'sec-fetch-site': 'cross-site' }, { origin: 'https://evil.example', host: 'app.example' }];
    for (const cross of crossSite) {
      const error = await rejection(guard.canActivate(contextFor(Probe.prototype.guarded, { ...cookie, ...cross })));
      expect(error.getStatus()).toBe(403);
      expect(error.getResponse()).toEqual({ result: 'cross-site' });
    }
    expect(openRequest).not.toHaveBeenCalled();
  });

  it('同源请求照常识别身份', async () => {
    const { guard, openRequest } = setup();
    const error = await rejection(guard.canActivate(contextFor(Probe.prototype.guarded, { 'sec-fetch-site': 'same-origin' })));
    expect(error.getStatus()).toBe(401);
    expect(openRequest).toHaveBeenCalledTimes(1);
  });

  it('没有声明的接口不受影响（跨站写请求仍由框架 CSRF 处理）', async () => {
    const { guard, openRequest } = setup();
    const error = await rejection(guard.canActivate(contextFor(Probe.prototype.plain, { 'sec-fetch-site': 'cross-site' })));
    expect(error.getStatus()).toBe(401);
    expect(openRequest).toHaveBeenCalledTimes(1);
  });
});
