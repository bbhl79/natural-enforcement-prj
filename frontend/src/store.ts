// 用途：Redux 商店的创建与根类型导出。
import { configureStore } from '@reduxjs/toolkit';

import loginReducer from './login/loginSlice';

/** 应用唯一的 Redux 商店。 */
export const store = configureStore({
  reducer: {
    login: loginReducer,
  },
});

/** 商店状态的根类型。 */
export type RootState = ReturnType<typeof store.getState>;
/** 商店的 dispatch 类型。 */
export type AppDispatch = typeof store.dispatch;
