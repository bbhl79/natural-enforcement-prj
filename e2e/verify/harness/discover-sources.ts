// 用途：读取已注册控制器与前端路由、菜单、线索地图源码文本，供发现器静态枚举。
// 发现器信号源 2（spec #322 二期 T5）：静态源码读取器。
// 唯一的读盘入口放在 harness/（discover/ 目录外），因为写边界守卫禁止 discover/*.ts import node:fs。
// 这里只读：把源码文本交给 discover/ 下的纯函数枚举与对账。
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  controllerClassName,
  registeredControllerClasses,
  type ControllerSource,
} from './discover/enumerate-capabilities.ts';
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
const APP_MODULE_FILE = 'backend/server/src/app.module.ts';
const ROUTER_FILE = 'frontend/src/router.tsx';
const MENU_FILE = 'frontend/src/shell/menu.ts';
const CLUE_URL_FILE = 'frontend/src/shell/clueUrl.ts';
const FEATURE_MAP_FILE =
  'e2e/verify/features/feature-map.md';

/** 递归列出控制器目录下全部 `*.controller.ts`，返回相对控制器根的 posix 路径。 */
async function listControllerFiles(dir: string, base: string = dir): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listControllerFiles(full, base)));
    } else if (entry.isFile() && entry.name.endsWith('.controller.ts')) {
      files.push(path.relative(base, full).split(path.sep).join('/'));
    }
  }
  return files.sort();
}

/**
 * 读全部已注册控制器与前端路由/菜单/地图源码。root 缺省为仓库根（容器内 /work）。
 * 控制器先递归读取子目录，再按 app.module.ts 的 `controllers:` 注册项过滤；
 * 未注册文件不计能力（注册是能力生效的前提）。
 */
export async function loadDiscoverSources(root: string = repoRoot()): Promise<DiscoverSources> {
  const controllerRoot = path.join(root, CONTROLLER_DIR);
  const [appModuleSource, controllerFiles] = await Promise.all([
    fs.readFile(path.join(root, APP_MODULE_FILE), 'utf8'),
    listControllerFiles(controllerRoot),
  ]);
  const registered = registeredControllerClasses(appModuleSource);

  const controllers: ControllerSource[] = [];
  for (const rel of controllerFiles) {
    const text = await fs.readFile(path.join(controllerRoot, rel), 'utf8');
    const className = controllerClassName(text);
    if (className === null || !registered.has(className)) continue;
    controllers.push({ file: path.posix.join(CONTROLLER_DIR, rel), text });
  }

  const [routerSource, menuSource, clueUrlSource, featureMapSource] = await Promise.all([
    fs.readFile(path.join(root, ROUTER_FILE), 'utf8'),
    fs.readFile(path.join(root, MENU_FILE), 'utf8'),
    fs.readFile(path.join(root, CLUE_URL_FILE), 'utf8'),
    fs.readFile(path.join(root, FEATURE_MAP_FILE), 'utf8'),
  ]);

  return { controllers, routerSource, menuSource, clueUrlSource, featureMapSource };
}
