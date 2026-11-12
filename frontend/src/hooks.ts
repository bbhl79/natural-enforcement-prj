// 用途：带类型的 Redux hooks，页面经它们读取状态与派发动作。
import { useDispatch, useSelector } from 'react-redux';

import type { AppDispatch, RootState } from './store';

/** 已绑定 AppDispatch 类型的 dispatch。 */
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
/** 已绑定 RootState 类型的选择器。 */
export const useAppSelector = useSelector.withTypes<RootState>();
