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

export interface NewSession {
  id: string;
  personnelId: string;
  secretHash: string;
  rememberMeChainId: string | null;
  authenticatedAt: Date;
  lastSeenAt: Date;
  absoluteEndsAt: Date;
}

export interface SessionStore {
  insert(row: NewSession): Promise<void>;
  findBySecretHash(secretHash: string): Promise<SessionRow | null>;
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

export const SESSION_CAPACITY = Symbol('SESSION_CAPACITY');
export const DEFAULT_SESSION_CAPACITY = 7500;

export const SESSION_STORE = Symbol('SESSION_STORE');
