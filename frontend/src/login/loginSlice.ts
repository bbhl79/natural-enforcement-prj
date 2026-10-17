import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';

import { forgetExpiryDismissed, readExpiryDismissed, rememberExpiryDismissed } from './expiryNotice';

/** 四态与原型 S00 一致。 */
export type LoginScreen = 'default' | 'error' | 'locked' | 'deactivated' | 'capacity';

/**
 * 认证状态。expired：已登录时某个接口返回 401，会话已结束，先说明再去登录页（P1）。
 * error：启动时会话查询失败（网络或服务不可用），可刷新重试（P1）。
 */
export type AuthPhase =
  | 'unknown'
  | 'anonymous'
  | 'password-change-required'
  | 'authenticated'
  | 'expired'
  | 'error';

export type PasswordChangeKind = 'first-login' | 'expired';

export const PASSWORD_RULE_TEXT: Record<string, string> = {
  'too-short': '口令至少 10 位',
  'too-long': '口令最多 64 位',
  'insufficient-classes': '大写、小写、数字、特殊字符中至少包含 3 类',
  sequential: '不能包含 4 位及以上连续数字或字母',
  repeated: '不能包含 4 位及以上重复字符',
  common: '不能使用常见弱口令',
  'contains-code': '不能包含本人工号',
  'same-as-current': '不能与当前口令相同',
};

export interface OperatorSession {
  name: string;
  code: string;
  orgName: string | null;
  roles: string[];
  /** 本人允许的操作码清单（会话查询返回，#105 菜单来源） */
  opcodes: string[];
}

export interface LoginState {
  screen: LoginScreen;
  phone: string;
  password: string;
  rememberMe: boolean;
  passwordVisible: boolean;
  phase: AuthPhase;
  operator: OperatorSession | null;
  passwordChangeKind: PasswordChangeKind | null;
  currentPassword: string;
  newPassword: string;
  ruleCodes: string[];
  currentPasswordRejected: boolean;
  daysRemaining: number | null;
  expiryNoticeDismissed: boolean;
  /** 主动退出后去登录页不记原路径 */
  explicitLogout: boolean;
  /**
   * 最近一次发出的会话查询的请求号，只采用它的结果（乱序时先发的作废）。
   * 退出、会话结束、重新登录时置为 STALE：之前发出、迟到的查询结果一律丢弃，
   * 不会把已退出的界面恢复成登录态。
   */
  sessionRequest: string | null;
}

const STALE = 'stale';

const initialState: LoginState = {
  screen: 'default',
  phone: '',
  password: '',
  rememberMe: false,
  passwordVisible: false,
  phase: 'unknown',
  operator: null,
  passwordChangeKind: null,
  currentPassword: '',
  newPassword: '',
  ruleCodes: [],
  currentPasswordRejected: false,
  daysRemaining: null,
  expiryNoticeDismissed: false,
  explicitLogout: false,
  sessionRequest: null,
};

export function expiryNoticeVisible(state: LoginState): boolean {
  return state.phase === 'authenticated'
    && state.daysRemaining !== null
    && state.daysRemaining <= 7
    && !state.expiryNoticeDismissed;
}

/** 403 且结果码为强制改密时，进入改口令。 */
export function passwordChangeKindFromDenial(
  status: number,
  result: string | undefined,
): PasswordChangeKind | null {
  if (status !== 403) return null;
  if (result === 'password-change-required') return 'first-login';
  if (result === 'password-expired') return 'expired';
  return null;
}

export function loginFormDisabled(screen: LoginScreen): boolean {
  return screen === 'locked' || screen === 'deactivated';
}

/** 两栏都非空才能登录。手机号去掉首尾空白；口令只拒绝空串，不裁剪。 */
export function loginSubmitEnabled(state: Pick<LoginState, 'screen' | 'phone' | 'password'>): boolean {
  return !loginFormDisabled(state.screen) && state.phone.trim() !== '' && state.password !== '';
}

type SessionView =
  | { result: 'anonymous' }
  | { result: 'password-change-required' }
  | { result: 'password-expired' }
  | ({ result: 'authenticated'; daysRemaining?: number; expiryNoticeDismissed?: boolean }
    & Omit<OperatorSession, 'opcodes'> & { opcodes?: string[] });

let startupReady: Promise<void> = Promise.resolve();
let startupArmed = false;

/** 启动时的会话查询完成前，其他请求停在这里。 */
export function waitForStartupSession(): Promise<void> {
  return startupReady;
}

function armStartupSession(): (() => void) | null {
  if (startupArmed) return null;
  startupArmed = true;
  let finish!: () => void;
  startupReady = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return () => {
    finish();
    startupReady = Promise.resolve();
  };
}

type LoginFailure = {
  result: 'invalid-credential' | 'password-change-required' | 'password-expired' | 'locked' | 'deactivated' | 'capacity-reached';
};

type SessionOperator = OperatorSession & { daysRemaining: number | null };

function operatorFrom(view: SessionView & { result: 'authenticated' }): SessionOperator {
  return {
    name: view.name,
    code: view.code,
    orgName: view.orgName,
    roles: view.roles,
    opcodes: Array.isArray(view.opcodes) ? view.opcodes : [],
    daysRemaining: typeof view.daysRemaining === 'number' ? view.daysRemaining : null,
  };
}

function operatorOnly(payload: OperatorSession): OperatorSession {
  return {
    name: payload.name,
    code: payload.code,
    orgName: payload.orgName,
    roles: payload.roles,
    opcodes: Array.isArray(payload.opcodes) ? payload.opcodes : [],
  };
}

/**
 * 会话查询。refresh 为真表示已在使用中重新拉一次（收到 403 后），失败时保持现状；
 * 否则是启动查询，失败时进入「暂时无法确认登录状态」。
 */
export const loadSession = createAsyncThunk<SessionView, { refresh?: boolean } | undefined>(
  'login/loadSession',
  async () => {
    const finish = armStartupSession();
    try {
      const response = await fetch('/api/auth/session', { cache: 'no-store' });
      const body = (await response.json()) as { result?: string; code?: string };
      const kind = passwordChangeKindFromDenial(response.status, body.result);
      if (kind === 'expired') return { result: 'password-expired' };
      if (kind === 'first-login') return { result: 'password-change-required' };
      if (!response.ok) throw new Error(`会话查询失败：HTTP ${response.status}`);
      if (body.result === 'authenticated' && typeof body.code === 'string') {
        return { ...(body as SessionView & { result: 'authenticated' }), expiryNoticeDismissed: readExpiryDismissed(body.code) };
      }
      return body as SessionView;
    } finally {
      finish?.();
    }
  },
);

export const submitLogin = createAsyncThunk<
  OperatorSession & { daysRemaining?: number | null },
  void,
  { state: { login: LoginState }; rejectValue: LoginFailure }
>(
  'login/submit',
  async (_, { getState, rejectWithValue }) => {
    const { phone, password, rememberMe } = getState().login;
    forgetExpiryDismissed();
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mobilePhone: phone.trim(),
        password,
        rememberMe,
      }),
    });
    const body = (await response.json()) as { result?: string };
    const denied = passwordChangeKindFromDenial(response.status, body.result);
    if (denied) {
      return rejectWithValue({
        result: denied === 'expired' ? 'password-expired' : 'password-change-required',
      });
    }
    if (body.result === 'established') {
      const session = await fetch('/api/auth/session', { cache: 'no-store' });
      const view = (await session.json()) as SessionView;
      if (view.result !== 'authenticated') {
        return rejectWithValue({ result: 'invalid-credential' });
      }
      return operatorFrom(view);
    }
    if (body.result === 'password-change-required' || body.result === 'password-expired') {
      return rejectWithValue({ result: body.result });
    }
    if (body.result === 'locked' || body.result === 'deactivated') {
      return rejectWithValue({ result: body.result });
    }
    if (response.status === 503 && body.result === 'capacity-reached') {
      return rejectWithValue({ result: 'capacity-reached' });
    }
    return rejectWithValue({ result: 'invalid-credential' });
  },
  {
    condition: (_, { getState }) => loginSubmitEnabled(getState().login),
  },
);

export const logout = createAsyncThunk('login/logout', async () => {
  forgetExpiryDismissed();
  await fetch('/api/auth/logout', { method: 'POST' });
});

/** 关闭口令到期横幅，并记下：同一会话不再出现。 */
export const closeExpiryNotice = createAsyncThunk<void, void, { state: { login: LoginState } }>(
  'login/closeExpiryNotice',
  async (_, { getState, dispatch }) => {
    const code = getState().login.operator?.code;
    if (code) rememberExpiryDismissed(code);
    dispatch(dismissExpiryNotice());
  },
);

type PasswordFailure =
  | { result: 'invalid-credential' }
  | { result: 'locked' }
  | { result: 'non-compliant'; rules: string[] }
  | { result: 'password-change' };

export const submitPassword = createAsyncThunk<
  OperatorSession & { daysRemaining?: number | null },
  void,
  { state: { login: LoginState }; rejectValue: PasswordFailure }
>(
  'login/submitPassword',
  async (_, { getState, rejectWithValue, dispatch }) => {
    const { currentPassword, newPassword } = getState().login;
    const response = await fetch('/api/auth/password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const body = (await response.json()) as { result?: string; rules?: string[] };
    const denied = passwordChangeKindFromDenial(response.status, body.result);
    if (denied) {
      dispatch(enterPasswordChange(denied));
      return rejectWithValue({ result: 'password-change' });
    }
    if (body.result === 'established') {
      const session = await fetch('/api/auth/session', { cache: 'no-store' });
      const view = (await session.json()) as SessionView;
      if (view.result !== 'authenticated') return rejectWithValue({ result: 'invalid-credential' });
      return operatorFrom(view);
    }
    if (body.result === 'non-compliant') {
      return rejectWithValue({ result: 'non-compliant', rules: body.rules ?? [] });
    }
    if (body.result === 'locked') return rejectWithValue({ result: 'locked' });
    return rejectWithValue({ result: 'invalid-credential' });
  },
  {
    condition: (_, { getState }) => {
      const state = getState().login;
      return state.currentPassword !== '' && state.newPassword !== '';
    },
  },
);

const loginSlice = createSlice({
  name: 'login',
  initialState,
  reducers: {
    setPhone(state, action: PayloadAction<string>) {
      if (loginFormDisabled(state.screen)) return;
      state.phone = action.payload;
    },
    setPassword(state, action: PayloadAction<string>) {
      if (loginFormDisabled(state.screen)) return;
      state.password = action.payload;
    },
    toggleRemember(state) {
      if (loginFormDisabled(state.screen)) return;
      state.rememberMe = !state.rememberMe;
    },
    togglePasswordVisible(state) {
      if (loginFormDisabled(state.screen)) return;
      state.passwordVisible = !state.passwordVisible;
    },
    forgotPassword(state) {
      state.screen = 'default';
    },
    setCurrentPassword(state, action: PayloadAction<string>) {
      state.currentPassword = action.payload;
      state.currentPasswordRejected = false;
    },
    setNewPassword(state, action: PayloadAction<string>) {
      state.newPassword = action.payload;
      state.ruleCodes = [];
    },
    dismissExpiryNotice(state) {
      state.expiryNoticeDismissed = true;
    },
    enterPasswordChange(state, action: PayloadAction<PasswordChangeKind>) {
      state.sessionRequest = STALE;
      state.phase = 'password-change-required';
      state.passwordChangeKind = action.payload;
      state.operator = null;
      state.screen = 'default';
    },
    /** 已登录时接口返回 401：会话已结束（P1）。 */
    sessionEnded(state) {
      if (state.phase !== 'authenticated') return;
      state.sessionRequest = STALE;
      state.phase = 'expired';
      state.operator = null;
      state.daysRemaining = null;
      state.expiryNoticeDismissed = false;
    },
    /** 看过「会话已结束」后去登录页，登录后回到原页。 */
    acknowledgeSessionEnd(state) {
      if (state.phase !== 'expired') return;
      state.phase = 'anonymous';
      state.explicitLogout = false;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadSession.pending, (state, action) => {
        state.sessionRequest = action.meta.requestId;
      })
      .addCase(loadSession.fulfilled, (state, action) => {
        if (state.sessionRequest !== null && state.sessionRequest !== action.meta.requestId) return;
        if (action.payload.result === 'authenticated') {
          const operator = operatorFrom(action.payload);
          state.phase = 'authenticated';
          state.passwordChangeKind = null;
          state.operator = operatorOnly(operator);
          state.daysRemaining = operator.daysRemaining;
          state.expiryNoticeDismissed = state.expiryNoticeDismissed || action.payload.expiryNoticeDismissed === true;
          state.explicitLogout = false;
          state.screen = 'default';
          return;
        }
        if (action.payload.result === 'password-change-required' || action.payload.result === 'password-expired') {
          state.phase = 'password-change-required';
          state.passwordChangeKind = action.payload.result === 'password-expired' ? 'expired' : 'first-login';
          state.operator = null;
          state.screen = 'default';
          return;
        }
        state.phase = 'anonymous';
        state.operator = null;
        state.passwordChangeKind = null;
        state.daysRemaining = null;
        state.expiryNoticeDismissed = false;
      })
      .addCase(loadSession.rejected, (state, action) => {
        if (state.sessionRequest !== null && state.sessionRequest !== action.meta.requestId) return;
        if (action.meta.arg?.refresh) return;
        state.phase = 'error';
        state.operator = null;
      })
      .addCase(submitLogin.pending, (state) => {
        state.sessionRequest = STALE;
      })
      .addCase(submitLogin.fulfilled, (state, action) => {
        state.phase = 'authenticated';
        state.passwordChangeKind = null;
        state.operator = operatorOnly(action.payload);
        state.explicitLogout = false;
        state.daysRemaining = action.payload.daysRemaining ?? null;
        state.expiryNoticeDismissed = false;
        state.screen = 'default';
        state.password = '';
      })
      .addCase(submitLogin.rejected, (state, action) => {
        if (!action.payload) return;
        state.operator = null;
        if (action.payload.result === 'password-change-required' || action.payload.result === 'password-expired') {
          state.phase = 'password-change-required';
          state.passwordChangeKind = action.payload.result === 'password-expired' ? 'expired' : 'first-login';
          state.screen = 'default';
          return;
        }
        if (action.payload.result === 'locked' || action.payload.result === 'deactivated') {
          state.phase = 'anonymous';
          state.passwordChangeKind = null;
          state.screen = action.payload.result;
          return;
        }
        if (action.payload.result === 'capacity-reached') {
          state.phase = 'anonymous';
          state.passwordChangeKind = null;
          state.screen = 'capacity';
          return;
        }
        state.phase = 'anonymous';
        state.passwordChangeKind = null;
        state.screen = 'error';
      })
      .addCase(submitPassword.fulfilled, (state, action) => {
        state.sessionRequest = STALE;
        state.phase = 'authenticated';
        state.passwordChangeKind = null;
        state.operator = operatorOnly(action.payload);
        state.explicitLogout = false;
        state.daysRemaining = action.payload.daysRemaining ?? null;
        state.expiryNoticeDismissed = false;
        state.currentPassword = '';
        state.newPassword = '';
        state.ruleCodes = [];
        state.currentPasswordRejected = false;
        state.screen = 'default';
      })
      .addCase(submitPassword.rejected, (state, action) => {
        if (!action.payload) return;
        if (action.payload.result === 'password-change') return;
        if (action.payload.result === 'non-compliant') {
          state.ruleCodes = action.payload.rules;
          state.currentPasswordRejected = false;
          return;
        }
        if (action.payload.result === 'locked') {
          state.screen = 'locked';
          state.currentPasswordRejected = false;
          state.ruleCodes = [];
          return;
        }
        state.currentPasswordRejected = true;
        state.ruleCodes = [];
      })
      .addCase(logout.pending, (state) => {
        state.sessionRequest = STALE;
      })
      .addCase(logout.fulfilled, (state) => {
        state.sessionRequest = STALE;
        state.phase = 'anonymous';
        state.operator = null;
        state.passwordChangeKind = null;
        state.screen = 'default';
        state.password = '';
        state.currentPassword = '';
        state.newPassword = '';
        state.ruleCodes = [];
        state.currentPasswordRejected = false;
        state.daysRemaining = null;
        state.expiryNoticeDismissed = false;
        state.explicitLogout = true;
      });
  },
});

export const {
  setPhone,
  setPassword,
  toggleRemember,
  togglePasswordVisible,
  forgotPassword,
  setCurrentPassword,
  setNewPassword,
  dismissExpiryNotice,
  enterPasswordChange,
  sessionEnded,
  acknowledgeSessionEnd,
} = loginSlice.actions;

export default loginSlice.reducer;
