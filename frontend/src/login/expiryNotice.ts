// 用途：口令到期横幅的关闭记录，按会话标签存在本标签页的 sessionStorage。
// 口令到期横幅的关闭记录（#105 X1）：同一会话关闭后不再出现，刷新页面也不再出现。
// 记在本标签页的 sessionStorage 里，值是会话查询返回的 noticeTag（服务端按会话单向派生，
// 换会话即变，含记住我新建的会话）；重新登录或退出时清掉。
// 运行环境没有 sessionStorage（单测）时什么都不记。

const KEY = 'ne.expiry-notice-dismissed';

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** 当前会话标签下，横幅是否已被关闭。 */
export function readExpiryDismissed(tag: string): boolean {
  return storage()?.getItem(KEY) === tag;
}

/** 记下当前会话标签的横幅已关闭；无 sessionStorage 时什么都不做。 */
export function rememberExpiryDismissed(tag: string): void {
  storage()?.setItem(KEY, tag);
}

/** 清掉关闭记录；登录、退出与改密时调用，换会话后横幅可再次出现。 */
export function forgetExpiryDismissed(): void {
  storage()?.removeItem(KEY);
}
