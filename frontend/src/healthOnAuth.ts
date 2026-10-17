import { createListenerMiddleware } from '@reduxjs/toolkit';

import { fetchHealthSnapshot } from './health/healthSlice';
import type { LoginState } from './login/loginSlice';

type WithLogin = { login: LoginState };

/**
 * 认证完成后自动读取一次健康快照（#103 评审）。
 * 只在认证状态从别的状态变为「已登录」时触发：启动会话查询、登录、改口令成功各一次。
 * 启动时的会话查询仍先返回，健康快照不抢在它前面发出。
 */
export function createHealthOnAuthMiddleware() {
  const listener = createListenerMiddleware();
  listener.startListening({
    predicate: (_action, current, previous) =>
      (previous as WithLogin).login.phase !== 'authenticated'
      && (current as WithLogin).login.phase === 'authenticated',
    effect: async (_action, api) => {
      await api.dispatch(fetchHealthSnapshot());
    },
  });
  return listener.middleware;
}
