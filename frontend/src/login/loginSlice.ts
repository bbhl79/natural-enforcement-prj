import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';

/** 四态与原型 S00 一致。锁定和停用由后续票切换。 */
export type LoginScreen = 'default' | 'error' | 'locked' | 'deactivated';

export type AuthPhase = 'unknown' | 'anonymous' | 'password-change-required' | 'authenticated';

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
}

const initialState: LoginState = {
  screen: 'default',
  phone: '',
  password: '',
  rememberMe: false,
  passwordVisible: false,
  phase: 'unknown',
  operator: null,
};

export function loginFormDisabled(screen: LoginScreen): boolean {
  return screen === 'locked' || screen === 'deactivated';
}

/** 两栏都非空才能登录。手机号去掉首尾空白；口令只拒绝空串，不裁剪。 */
export function loginSubmitEnabled(state: Pick<LoginState, 'screen' | 'phone' | 'password'>): boolean {
  return !loginFormDisabled(state.screen) && state.phone.trim() !== '' && state.password !== '';
}

type SessionView =
  | { result: 'anonymous' }
  | ({ result: 'authenticated' } & OperatorSession);

type LoginFailure = { result: 'invalid-credential' | 'password-change-required' };

export const loadSession = createAsyncThunk<SessionView>('login/loadSession', async () => {
  const response = await fetch('/api/auth/session', { cache: 'no-store' });
  if (!response.ok) return { result: 'anonymous' };
  return (await response.json()) as SessionView;
});

export const submitLogin = createAsyncThunk<
  OperatorSession,
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
      return {
        name: view.name,
        code: view.code,
        orgName: view.orgName,
        roles: view.roles,
      };
    }
    if (body.result === 'password-change-required') {
      return rejectWithValue({ result: 'password-change-required' });
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
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadSession.fulfilled, (state, action) => {
        if (action.payload.result === 'authenticated') {
          state.phase = 'authenticated';
          state.operator = {
            name: action.payload.name,
            code: action.payload.code,
            orgName: action.payload.orgName,
            roles: action.payload.roles,
          };
          state.screen = 'default';
          return;
        }
        state.phase = 'anonymous';
        state.operator = null;
      })
      .addCase(loadSession.rejected, (state) => {
        state.phase = 'anonymous';
        state.operator = null;
      })
      .addCase(submitLogin.fulfilled, (state, action) => {
        state.phase = 'authenticated';
        state.operator = action.payload;
        state.screen = 'default';
        state.password = '';
      })
      .addCase(submitLogin.rejected, (state, action) => {
        if (!action.payload) return;
        state.operator = null;
        if (action.payload.result === 'password-change-required') {
          state.phase = 'password-change-required';
          state.screen = 'default';
          return;
        }
        state.phase = 'anonymous';
        state.screen = 'error';
      })
      .addCase(logout.fulfilled, (state) => {
        state.phase = 'anonymous';
        state.operator = null;
        state.screen = 'default';
        state.password = '';
      });
  },
});

export const {
  setPhone,
  setPassword,
  toggleRemember,
  togglePasswordVisible,
  forgotPassword,
} = loginSlice.actions;

export default loginSlice.reducer;
