// 用途：以 node 的模块注册钩子加载 load-typescript.mjs，让 .js 后缀解析到 .ts 源码。
import { register } from 'node:module';

register('./load-typescript.mjs', import.meta.url);
