// 业务接口的统一出口（#91 约定第 4 条、#105「收到 403 时重新拉一次会话」）。
// - 启动时的会话查询完成前，请求先等待。
// - 401：会话已结束，进入 P1「会话已结束」，再去登录页并记下当前路径。
// - 403 且结果码为强制改密：进入改口令。
// - 其他 403：重新拉一次会话，菜单随之更新。是否有权由服务端决定，前端不据此放行。

import type { ThunkDispatch, UnknownAction } from '@reduxjs/toolkit';

import {
  enterPasswordChange,
  loadSession,
  passwordChangeKindFromDenial,
  sessionEnded,
  waitForStartupSession,
  type LoginState,
} from './login/loginSlice';

export type ApiDispatch = ThunkDispatch<{ login: LoginState }, unknown, UnknownAction>;

export async function apiFetch(dispatch: ApiDispatch, input: string, init: RequestInit = {}): Promise<Response> {
  await waitForStartupSession();
  const response = await fetch(input, { cache: 'no-store', ...init });
  if (response.status === 401) {
    dispatch(sessionEnded());
    return response;
  }
  if (response.status === 403) {
    let result: string | undefined;
    try {
      result = ((await response.clone().json()) as { result?: string }).result;
    } catch {
      result = undefined;
    }
    const kind = passwordChangeKindFromDenial(response.status, result);
    if (kind) {
      dispatch(enterPasswordChange(kind));
    } else {
      await dispatch(loadSession({ refresh: true }));
    }
  }
  return response;
}
