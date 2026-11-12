// 用途：前端入口：把 Redux 与路由挂到根节点。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { RouterProvider } from 'react-router/dom';

import './index.css';
import { createAppRouter } from './router';
import { store } from './store';

const container = document.getElementById('root');
if (!container) {
  throw new Error('未找到 #root 挂载点');
}

const router = createAppRouter(store);

createRoot(container).render(
  <StrictMode>
    <Provider store={store}>
      <RouterProvider router={router} />
    </Provider>
  </StrictMode>,
);
