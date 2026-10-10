// integration 层最小 process 环境类型（沿用 #55 队列设施包 env.d.ts 既定纪律：
// 仓库不引入 @types/node——版本未入定案表，不为一个全局拉入整包类型依赖；
// 仅声明本层实际消费的成员。后续切片若引入 @types/node，本文件应删除）。
interface ProcessEnv {
  DATABASE_URL?: string | undefined;
}

declare const process: {
  env: ProcessEnv;
};
