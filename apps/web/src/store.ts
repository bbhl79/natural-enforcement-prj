import { configureStore } from '@reduxjs/toolkit'
import { neApi } from './api.js'

export function createAppStore() {
  return configureStore({
    reducer: { [neApi.reducerPath]: neApi.reducer },
    middleware: (getDefault) => getDefault().concat(neApi.middleware),
  })
}

export type AppStore = ReturnType<typeof createAppStore>

export const store = createAppStore()
