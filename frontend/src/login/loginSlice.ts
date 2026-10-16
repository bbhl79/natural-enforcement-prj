import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';

/** 四态与原型 S00 一致。锁定和停用由后续票切换。 */
export type LoginScreen = 'default' | 'error' | 'locked' | 'deactivated';

export type AuthPhase = 'unknown' | 'anonymous' | 'password-change-required' | 'authenticated';

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
}

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
  | ({ result: 'authenticated'; daysRemaining?: number } & OperatorSession);

type LoginFailure = { result: 'invalid-credential' | 'password-change-required' | 'password-expired' };

function operatorFrom(view: SessionView & { result: 'authenticated' }): OperatorSession & { daysRemaining: number | null } {
  return {
    name: view.name,
    code: view.code,
    orgName: view.orgName,
    roles: view.roles,
    daysRemaining: typeof view.daysRemaining === 'number' ? view.daysRemaining : null,
  };
}

export const loadSession = createAsyncThunk<SessionView>('login/loadSession', async () => {
  const response = await fetch('/api/auth/session', { cache: 'no-store' });
  if (!response.ok) return { result: 'anonymous' };
  return (await response.json()) as SessionView;
});

export const submitLogin = createAsyncThunk<
  OperatorSession & { daysRemaining?: number | null },
  void,
  { state: { login: LoginState }; rejectValue: LoginFailure }
>(
  'login/submit',
  async (_, { getState, rejectWithValue }) => {
    const { phone, password, rememberMe } = getState().login;
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
    return rejectWithValue({ result: 'invalid-credential' });
  },
  {
    condition: (_, { getState }) => loginSubmitEnabled(getState().login),
  },
);

export const logout = createAsyncThunk('login/logout', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
});

type PasswordFailure =
  | { result: 'invalid-credential' }
  | { result: 'non-compliant'; rules: string[] };

export const submitPassword = createAsyncThunk<
  OperatorSession & { daysRemaining?: number | null },
  void,
  { state: { login: LoginState }; rejectValue: PasswordFailure }
>(
  'login/submitPassword',
  async (_, { getState, rejectWithValue }) => {
    const { currentPassword, newPassword } = getState().login;
    const response = await fetch('/api/auth/password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const body = (await response.json()) as { result?: string; rules?: string[] };
    if (body.result === 'established') {
      const session = await fetch('/api/auth/session', { cache: 'no-store' });
      const view = (await session.json()) as SessionView;
      if (view.result !== 'authenticated') return rejectWithValue({ result: 'invalid-credential' });
      return operatorFrom(view);
    }
    if (body.result === 'non-compliant') {
      return rejectWithValue({ result: 'non-compliant', rules: body.rules ?? [] });
    }
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
      state.phase = 'password-change-required';
      state.passwordChangeKind = action.payload;
      state.operator = null;
      state.screen = 'default';
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadSession.fulfilled, (state, action) => {
        if (action.payload.result === 'authenticated') {
          state.phase = 'authenticated';
          state.passwordChangeKind = null;
          state.operator = {
            name: action.payload.name,
            code: action.payload.code,
            orgName: action.payload.orgName,
            roles: action.payload.roles,
          };
          state.daysRemaining = typeof action.payload.daysRemaining === 'number'
            ? action.payload.daysRemaining
            : null;
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
      .addCase(loadSession.rejected, (state) => {
        state.phase = 'anonymous';
        state.operator = null;
      })
      .addCase(submitLogin.fulfilled, (state, action) => {
        state.phase = 'authenticated';
        state.passwordChangeKind = null;
        state.operator = {
          name: action.payload.name,
          code: action.payload.code,
          orgName: action.payload.orgName,
          roles: action.payload.roles,
        };
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
        state.phase = 'anonymous';
        state.passwordChangeKind = null;
        state.screen = 'error';
      })
      .addCase(submitPassword.fulfilled, (state, action) => {
        state.phase = 'authenticated';
        state.passwordChangeKind = null;
        state.operator = {
          name: action.payload.name,
          code: action.payload.code,
          orgName: action.payload.orgName,
          roles: action.payload.roles,
        };
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
        if (action.payload.result === 'non-compliant') {
          state.ruleCodes = action.payload.rules;
          state.currentPasswordRejected = false;
          return;
        }
        state.currentPasswordRejected = true;
        state.ruleCodes = [];
      })
      .addCase(logout.fulfilled, (state) => {
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
} = loginSlice.actions;

export default loginSlice.reducer;
