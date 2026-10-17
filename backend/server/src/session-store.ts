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
  end(id: string, endedAt: Date, reason: string): Promise<void>;
  listActive(personnelId: string): Promise<SessionRow[]>;
  /** 尚未写入结束时间的会话。调用方再按时间判断是否仍占名额。 */
  listOpen(): Promise<SessionRow[]>;
}

export const SESSION_CAPACITY = Symbol('SESSION_CAPACITY');
export const DEFAULT_SESSION_CAPACITY = 7500;

export const SESSION_STORE = Symbol('SESSION_STORE');
