// 会话就绪：根 loader 与页面 loader 并行执行，页面 loader 取数前要先等同一次会话查询。
import type { ApiDispatch } from './api';
import { loadSession, type LoginState } from './login/loginSlice';

export interface SessionStore {
  getState(): { login: LoginState };
  dispatch: ApiDispatch;
}

const inflight = new WeakMap<SessionStore, Promise<void>>();

/** 认证状态未知时发起（或复用进行中的）会话查询；已知时立即返回。 */
export function ensureSession(store: SessionStore): Promise<void> {
  if (store.getState().login.phase !== 'unknown') return Promise.resolve();
  let pending = inflight.get(store);
  if (!pending) {
    pending = Promise.resolve(store.dispatch(loadSession()))
      .then(() => undefined)
      .finally(() => inflight.delete(store));
    inflight.set(store, pending);
  }
  return pending;
}

/** 会话就绪后的操作码清单；未登录或强制改密时为空。 */
export async function sessionOpcodes(store: SessionStore): Promise<readonly string[]> {
  await ensureSession(store);
  const login = store.getState().login;
  return login.phase === 'authenticated' ? login.operator?.opcodes ?? [] : [];
}
