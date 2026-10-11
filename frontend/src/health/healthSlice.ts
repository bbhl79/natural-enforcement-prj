import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';

/**
 * health 面板数据契约（#56）。
 * 快照唯一生产者 = dev 脚本（dev health / dev up 写入命名卷，经 nginx 同域静态端点
 * /health/health.json 提供）；前端不直连库、不探容器，只消费本契约。
 */
export interface HealthCheck {
  id: string;
  label: string;
  status: 'ok' | 'fail';
  detail: string;
}

export interface HealthSnapshot {
  generatedAt: string;
  checks: HealthCheck[];
}

export type HealthLoadState = 'idle' | 'loading' | 'succeeded' | 'failed';

export interface HealthState {
  loadState: HealthLoadState;
  snapshot: HealthSnapshot | null;
  error: string | null;
}

const initialState: HealthState = {
  loadState: 'idle',
  snapshot: null,
  error: null,
};

export const fetchHealthSnapshot = createAsyncThunk<
  HealthSnapshot,
  void,
  { rejectValue: string }
>('health/fetchSnapshot', async (_, { rejectWithValue }) => {
  try {
    const response = await fetch('/health/health.json', { cache: 'no-store' });
    if (!response.ok) {
      return rejectWithValue(`health 快照请求失败：HTTP ${response.status}`);
    }
    return (await response.json()) as HealthSnapshot;
  } catch (error) {
    return rejectWithValue(
      error instanceof Error ? error.message : 'health 快照请求失败',
    );
  }
});

const healthSlice = createSlice({
  name: 'health',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchHealthSnapshot.pending, (state) => {
        state.loadState = 'loading';
        state.error = null;
      })
      .addCase(fetchHealthSnapshot.fulfilled, (state, action) => {
        state.loadState = 'succeeded';
        state.snapshot = action.payload;
      })
      .addCase(fetchHealthSnapshot.rejected, (state, action) => {
        state.loadState = 'failed';
        state.error = action.payload ?? 'health 快照请求失败';
      });
  },
});

export default healthSlice.reducer;
