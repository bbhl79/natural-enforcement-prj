// 用途：会话行的形状、会话存储端口与容量配置令牌。
// 调用方：backend/server/src/auth.service.ts、backend/server/src/session.guard.ts、backend/server/src/unit-of-work.ts；实现装配在 backend/server/src/persistence.module.ts。
// 边界：touch 只在库中时间更早时推进；end 是条件更新，并发先提交时返回 false。
//
/** 一段会话行：记住我链号为空表示非「记住我」建立的会话。 */
export interface SessionRow {
  id: string;
  personnelId: string;
  secretHash: string;
  rememberMeChainId: string | null;
  authenticatedAt: Date;
  lastSeenAt: Date;
  absoluteEndsAt: Date;
  endedAt: Date | null;
}

/** 待插入的会话行：id 已由调用方生成，散列与时间已算好。 */
export interface NewSession {
  id: string;
  personnelId: string;
  secretHash: string;
  rememberMeChainId: string | null;
  authenticatedAt: Date;
  lastSeenAt: Date;
  absoluteEndsAt: Date;
}

/** 会话存储端口：插入、按散列查找、推进活动时间、结束与列出活动会话。 */
export interface SessionStore {
  insert(row: NewSession): Promise<void>;
  findBySecretHash(secretHash: string): Promise<SessionRow | null>;
  /**
   * 把活动时间向前推进。库中时间已不早于本次，或会话已结束时，不写。
   * 这样后到的更早更新不会触发「last_seen_at 不可倒退」。
   */
  touch(id: string, lastSeenAt: Date): Promise<void>;
  /**
   * 结束一段尚未结束的会话（条件更新：ended_at 为空才写），返回是否实际结束。
   * 并发退出/结束会话先提交时返回 false，调用方据此不补写 session.ended。
   */
  end(id: string, endedAt: Date, reason: string): Promise<boolean>;
  /**
   * 本人尚未结束的会话，按 (认证时间, 会话 id) 升序。
   * 认证时间只到毫秒，同一毫秒内靠会话 id 定先后（#116）。第一段是最旧的一段。
   */
  listActive(personnelId: string): Promise<SessionRow[]>;
  /** 尚未写入结束时间的会话。调用方再按时间判断是否仍占名额。 */
  listOpen(): Promise<SessionRow[]>;
}

/** 注入令牌：系统内同时活动会话的容量上限，登录与换发时按它判断是否还能建会话。 */
export const SESSION_CAPACITY = Symbol('SESSION_CAPACITY');
/** 容量上限的默认值。 */
export const DEFAULT_SESSION_CAPACITY = 7500;

/** 注入令牌：根客户端上的会话存储，事务内用 TxScope 上的 sessions。 */
export const SESSION_STORE = Symbol('SESSION_STORE');
