// 口令到期横幅的关闭记录（#105 X1）：同一会话关闭后不再出现，刷新页面也不再出现。
// 记在本标签页的 sessionStorage 里，键值是人员工号；重新登录或退出时清掉。
// 运行环境没有 sessionStorage（单测）时什么都不记。

const KEY = 'ne.expiry-notice-dismissed';

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function readExpiryDismissed(code: string): boolean {
  return storage()?.getItem(KEY) === code;
}

export function rememberExpiryDismissed(code: string): void {
  storage()?.setItem(KEY, code);
}

export function forgetExpiryDismissed(): void {
  storage()?.removeItem(KEY);
}
