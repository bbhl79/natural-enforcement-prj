唯一树中的后端目录。Nest 12，健康检查为 `GET /health`。

Prisma 7.10 的 schema 在 `prisma/schema.prisma`，生成目录是 `generated/`。本票不提交迁移。PostGIS 扩展留给迁移 0001 创建。

认证只预留本地 argon2 与 IdP 口，没有登录路由。
