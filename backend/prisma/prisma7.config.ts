// Prisma 7 配置文件（dev db 唯一读取入口；#49 落地）。
// DATABASE_URL 由 dev 脚本经容器环境变量注入，不在仓库落任何凭据。
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "schema.prisma",
  migrations: {
    path: "migrations",
    seed: "node --experimental-transform-types --disable-warning=ExperimentalWarning seed.mjs",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
