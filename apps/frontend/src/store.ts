import { configureStore } from "@reduxjs/toolkit";

function appReducer(state: { ready: boolean } = { ready: true }) {
  return state;
}

export const store = configureStore({
  reducer: { app: appReducer },
});

export type RootState = ReturnType<typeof store.getState>;
