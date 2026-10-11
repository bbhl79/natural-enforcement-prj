// integration 层最小 process 环境类型（沿用 #55 队列设施包 env.d.ts 既定纪律：
// 仓库不引 @types/node 直接依赖——VERSIONS.md「类型」行钉的 24.19.0 只是 overrides 收敛出的
// vite/vitest peer 传递依赖，任何 package.json 均未声明；不为一个全局拉入整包类型依赖，
// 仅声明本层实际消费的成员。后续切片若引入 @types/node 直接依赖，本文件应删除）。
interface ProcessEnv {
  DATABASE_URL?: string | undefined;
}

declare const process: {
  env: ProcessEnv;
};
