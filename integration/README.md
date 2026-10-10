# integration 测试层约定（#46 三层映射：integration = 结构测试 + 需库用例）

本层用例由 `dev test integration`（或裸 `dev test` = unit + integration）执行。

## 两种形态

1. **Vitest 需库用例**：`integration/**/*.test.ts`，在工具链容器内运行（接入 compose
   项目网络，`DATABASE_URL` 已注入），跑测试前 harness 会自动 `prisma generate`。
   配置文件 `vitest.config.ts` / `tsconfig.json` 自带，不并根 tsconfig（根 unit 层
   无库、无生成客户端，保持互不污染）。
2. **可执行脚本用例**：`integration/*.sh`（非 `_` 开头），bash 自包含，用例只测外部
   可观察行为（退出码 + 人类可读输出），自行经 compose 访问服务（参考
   `e2e/cases/03-command-smoke.sh` 的写法与隔离环境变量用法）。

## 纪律

- 退出码只有 0/1；失败输出要人类可读。
- 用例必须自清理（down 到用例启动前的状态），绝不删数据卷——唯一毁数入口是 `dev db reset`。
- 种子/参考数据经 `backend/prisma` 迁移与种子通道进入，不在用例里私建表。
- 依赖只进容器/命名卷：脚本里起容器统一挂 `${PROJECT}-pnpm-store` 或复用 harness 卷。
