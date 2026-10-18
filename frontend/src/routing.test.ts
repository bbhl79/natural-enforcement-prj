import { describe, expect, it } from 'vitest';

import { authRedirect, HOME_PATH, LOGIN_PATH, PASSWORD_PATH, safeNext, withNext } from './routing';

describe('next 参数校验（#91 约定第 3 条）', () => {
  it('只接受以单个 / 开头的站内路径', () => {
    expect(safeNext('/admin')).toBe('/admin');
    expect(safeNext('/admin/locked-personnel?page=2')).toBe('/admin/locked-personnel?page=2');
    expect(safeNext('/')).toBe('/');
  });

  it.each([
    ['空值', null],
    ['空串', ''],
    ['双斜杠', '//evil.example.com/x'],
    ['带协议', 'https://evil.example.com/'],
    ['javascript 协议', 'javascript:alert(1)'],
    ['不以 / 开头', 'admin'],
    ['反斜杠变体', '/\\evil.example.com'],
    ['认证页 /auth/login', '/auth/login'],
    ['认证页 /auth/password', '/auth/password?next=%2Fadmin'],
    ['认证接口前缀', '/auth/'],
    ['/auth 本身', '/auth'],
    ['经 .. 归一到 /auth/', '/x/../auth/login'],
    ['经 .. 归一出双斜杠', '/x/..//evil.example/path'],
    ['经编码点段归一出双斜杠', '/x/%2e%2e//evil.example/path'],
  ])('反例：%s', (_label, raw) => {
    expect(safeNext(raw)).toBeNull();
  });

  it('去认证页时记下原路径；首页和不合规的值不带 next', () => {
    expect(withNext(LOGIN_PATH, '/admin')).toBe('/auth/login?next=%2Fadmin');
    expect(withNext(LOGIN_PATH, '/')).toBe(LOGIN_PATH);
    expect(withNext(PASSWORD_PATH, '//evil.example.com')).toBe(PASSWORD_PATH);
  });
});

describe('按认证状态改写地址（#91 约定第 2 条）', () => {
  const at = (pathname: string, search = '') => ({ pathname, search });

  it('未登录访问受保护页 → 登录页并记下原路径', () => {
    expect(authRedirect('anonymous', at('/admin', '?tab=1'))).toBe('/auth/login?next=%2Fadmin%3Ftab%3D1');
    expect(authRedirect('anonymous', at('/'))).toBe(LOGIN_PATH);
    expect(authRedirect('anonymous', at(LOGIN_PATH, '?next=%2Fadmin'))).toBeNull();
  });

  it('主动退出后不记原路径', () => {
    expect(authRedirect('anonymous', at('/admin'), { keepPath: false })).toBe(LOGIN_PATH);
  });

  it('未登录停在改口令页 → 登录页，next 原样转交', () => {
    expect(authRedirect('anonymous', at(PASSWORD_PATH, '?next=%2Fadmin'))).toBe('/auth/login?next=%2Fadmin');
  });

  it('强制改密访问其他页 → 改口令页并记下原路径', () => {
    expect(authRedirect('password-change-required', at('/admin/audit'))).toBe('/auth/password?next=%2Fadmin%2Faudit');
    expect(authRedirect('password-change-required', at(LOGIN_PATH, '?next=%2Fadmin'))).toBe('/auth/password?next=%2Fadmin');
    expect(authRedirect('password-change-required', at(PASSWORD_PATH))).toBeNull();
  });

  it('已登录访问认证页 → 回到 next；没有或不合规时到首页', () => {
    expect(authRedirect('authenticated', at(LOGIN_PATH, '?next=%2Fadmin'))).toBe('/admin');
    expect(authRedirect('authenticated', at(PASSWORD_PATH, '?next=%2Fadmin'))).toBe('/admin');
    expect(authRedirect('authenticated', at(LOGIN_PATH, '?next=https%3A%2F%2Fevil.example.com'))).toBe(HOME_PATH);
    expect(authRedirect('authenticated', at(LOGIN_PATH, '?next=%2F%2Fevil.example.com'))).toBe(HOME_PATH);
    expect(authRedirect('authenticated', at(LOGIN_PATH, '?next=%2Fauth%2Fpassword'))).toBe(HOME_PATH);
    expect(authRedirect('authenticated', at(LOGIN_PATH, '?next=%2Fx%2F..%2F%2Fevil.example%2Fpath'))).toBe(HOME_PATH);
    expect(authRedirect('authenticated', at('/admin'))).toBeNull();
  });

  it('认证状态未知、会话查询失败、会话已结束时不改写', () => {
    for (const phase of ['unknown', 'error', 'expired'] as const) {
      expect(authRedirect(phase, at('/admin'))).toBeNull();
      expect(authRedirect(phase, at(LOGIN_PATH, '?next=%2Fadmin'))).toBeNull();
    }
  });
});
