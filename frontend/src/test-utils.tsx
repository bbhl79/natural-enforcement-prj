// 单测辅助：用内存路由跑完 loader，再静态渲染整棵应用（node 环境，无 DOM）。
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import type { EnhancedStore } from '@reduxjs/toolkit';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { appRoutes, type RouterStore } from './router';

export type AppRouter = ReturnType<typeof createMemoryRouter>;

/** 等路由初始化完成且没有进行中的导航与延迟数据。 */
export async function settled(router: AppRouter): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (router.state.initialized && router.state.navigation.state === 'idle') {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (router.state.navigation.state === 'idle') return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('路由没有稳定下来');
}

export function renderRouter(store: RouterStore, router: AppRouter): string {
  return renderToStaticMarkup(
    <Provider store={store as unknown as EnhancedStore}>
      <RouterProvider router={router} />
    </Provider>,
  );
}

export async function renderRoute(store: RouterStore, path: string): Promise<{ html: string; router: AppRouter }> {
  const router = createMemoryRouter(appRoutes(store), { initialEntries: [path] });
  await settled(router);
  return { html: renderRouter(store, router), router };
}
