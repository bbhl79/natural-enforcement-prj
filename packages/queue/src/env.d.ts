// #55：队列设施包消费的最小 process 环境类型。仓库不引 @types/node 直接依赖
//（VERSIONS.md「类型」行钉的 24.19.0 只是 overrides 收敛 vite/vitest 的 peer 传递依赖，
// 任何 package.json 均未声明），故本包编译时 Node 全局类型面不在场：不为一个 process
// 拉入整包类型依赖，仅声明本包实际消费的成员。
// 后续切片若引入 @types/node 直接依赖，本文件应删除（全局声明会相撞）。
interface ProcessEnv {
  REDIS_URL?: string | undefined;
}

declare const process: {
  env: ProcessEnv;
  exitCode?: number | undefined;
};
