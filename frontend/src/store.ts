import { configureStore } from '@reduxjs/toolkit';

import healthReducer from './health/healthSlice';
import loginReducer from './login/loginSlice';
import { createHealthOnAuthMiddleware } from './healthOnAuth';

export const store = configureStore({
  reducer: {
    health: healthReducer,
    login: loginReducer,
  },
  middleware: (getDefault) => getDefault().prepend(createHealthOnAuthMiddleware()),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
