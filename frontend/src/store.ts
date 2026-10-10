import { configureStore } from '@reduxjs/toolkit';

import healthReducer from './health/healthSlice';

export const store = configureStore({
  reducer: {
    health: healthReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
