import { configureStore } from '@reduxjs/toolkit';

import healthReducer from './health/healthSlice';
import loginReducer from './login/loginSlice';

export const store = configureStore({
  reducer: {
    health: healthReducer,
    login: loginReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
