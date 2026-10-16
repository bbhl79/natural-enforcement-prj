import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/** 四态与原型 S00 一致。本票只停在默认态：点登录不建立会话，也不切换画面。 */
export type LoginScreen = 'default' | 'error' | 'locked' | 'deactivated';

export interface LoginState {
  screen: LoginScreen;
  phone: string;
  password: string;
  rememberMe: boolean;
  passwordVisible: boolean;
  session: null;
}

const initialState: LoginState = {
  screen: 'default',
  phone: '',
  password: '',
  rememberMe: false,
  passwordVisible: false,
  session: null,
};

export function loginFormDisabled(screen: LoginScreen): boolean {
  return screen === 'locked' || screen === 'deactivated';
}

/** 两栏都非空才能登录。手机号去掉首尾空白；口令只拒绝空串，不裁剪。 */
export function loginSubmitEnabled(state: Pick<LoginState, 'screen' | 'phone' | 'password'>): boolean {
  return !loginFormDisabled(state.screen) && state.phone.trim() !== '' && state.password !== '';
}

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
    submitLogin(state) {
      if (!loginSubmitEnabled(state)) return;
      state.session = null;
    },
  },
});

export const {
  setPhone,
  setPassword,
  toggleRemember,
  togglePasswordVisible,
  forgotPassword,
  submitLogin,
} = loginSlice.actions;

export default loginSlice.reducer;
