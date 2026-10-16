export interface RememberMeRow {
  id: string;
  personnelId: string;
  chainId: string;
  secretHash: string;
  absoluteEndsAt: Date;
  predecessorId: string | null;
  endedAt: Date | null;
  endReason: string | null;
  createdAt: Date;
}

export interface NewRememberMe {
  id: string;
  personnelId: string;
  chainId: string;
  secretHash: string;
  absoluteEndsAt: Date;
  predecessorId: string | null;
  createdAt: Date;
}

export interface RememberMeStore {
  insert(row: NewRememberMe): Promise<void>;
  findBySecretHash(secretHash: string): Promise<RememberMeRow | null>;
  findSuccessor(predecessorId: string): Promise<RememberMeRow | null>;
  end(id: string, endedAt: Date, reason: string): Promise<void>;
  endActiveOnChain(chainId: string, endedAt: Date, reason: string): Promise<void>;
  endActiveForPersonnel(personnelId: string, endedAt: Date, reason: string): Promise<void>;
  /** 先结束旧行，再插入后继。第二次插入被唯一约束卡住时返回 lost-race。 */
  rotate(currentId: string, next: NewRememberMe, endedAt: Date): Promise<'rotated' | 'lost-race'>;
}

export const REMEMBER_ME_STORE = Symbol('REMEMBER_ME_STORE');
