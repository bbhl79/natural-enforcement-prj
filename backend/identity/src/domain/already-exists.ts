import type { IdentityUniqueConflict } from '../persistence/identity-store.ts';

/**
 * 业务唯一冲突（#119）。存储层返回 already-exists 结果，服务层不能继续时抛出本错误。
 * 接口层据 conflict 返回 409 already-exists，不出现 500。
 */
export class AlreadyExistsError extends Error {
  constructor(readonly conflict: IdentityUniqueConflict) {
    super(`已存在：${conflict}`);
    this.name = 'AlreadyExistsError';
  }
}

export function isAlreadyExists(error: unknown): error is AlreadyExistsError {
  return error instanceof AlreadyExistsError;
}
