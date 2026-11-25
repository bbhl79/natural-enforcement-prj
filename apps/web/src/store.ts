import { configureStore } from '@reduxjs/toolkit'
import { neApi } from './api.js'

export const store = configureStore({
  reducer: { [neApi.reducerPath]: neApi.reducer },
  middleware: (getDefault) => getDefault().concat(neApi.middleware),
})
