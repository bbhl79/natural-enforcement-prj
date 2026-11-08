// 发现器信号源 2（spec #322 二期 T5）：静态源码读取器。
// 唯一的读盘入口放在 harness/（discover/ 目录外），因为写边界守卫禁止 discover/*.ts import node:fs。
// 这里只读：把源码文本交给 discover/ 下的纯函数枚举与对账。
import fs from 'node:fs/promises';
import path from 'node:path';

import type { ControllerSource } from './discover/enumerate-capabilities.ts';
import { repoRoot } from './paths.ts';

/** 静态枚举所需的全部源码文本（读盘后原样传递，不做解析）。 */
export interface DiscoverSources {
  readonly controllers: readonly ControllerSource[];
  readonly routerSource: string;
  readonly menuSource: string;
  readonly clueUrlSource: string;
  readonly featureMapSource: string;
}

const CONTROLLER_DIR = 'backend/server/src';
const ROUTER_FILE = 'frontend/src/router.tsx';
const MENU_FILE = 'frontend/src/shell/menu.ts';
const CLUE_URL_FILE = 'frontend/src/shell/clueUrl.ts';
const FEATURE_MAP_FILE =
  '.cursor/skills/verify-natural-enforcement/features/feature-map.md';

/** 读全部控制器与前端路由/菜单/地图源码。root 缺省为仓库根（容器内 /work）。 */
export async function loadDiscoverSources(root: string = repoRoot()): Promise<DiscoverSources> {
  const controllerDir = path.join(root, CONTROLLER_DIR);
  const controllerFiles = (await fs.readdir(controllerDir))
    .filter((name) => name.endsWith('.controller.ts'))
    .sort();

  const controllers = await Promise.all(
    controllerFiles.map(async (file) => ({
      file: path.posix.join(CONTROLLER_DIR, file),
      text: await fs.readFile(path.join(controllerDir, file), 'utf8'),
    })),
  );

  const [routerSource, menuSource, clueUrlSource, featureMapSource] = await Promise.all([
    fs.readFile(path.join(root, ROUTER_FILE), 'utf8'),
    fs.readFile(path.join(root, MENU_FILE), 'utf8'),
    fs.readFile(path.join(root, CLUE_URL_FILE), 'utf8'),
    fs.readFile(path.join(root, FEATURE_MAP_FILE), 'utf8'),
  ]);

  return { controllers, routerSource, menuSource, clueUrlSource, featureMapSource };
}
