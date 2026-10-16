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
}

export const SESSION_STORE = Symbol('SESSION_STORE');
