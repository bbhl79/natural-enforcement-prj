# gzgt

唯一工程目录。禁止另起第二套树。本地只有 `./dev` 一个入口。

| 路径 | 用途 |
|---|---|
| `apps/backend` | 后端 |
| `apps/frontend` | 前端 |
| `packages/shield` | 契约 |
| `e2e` | 端到端 |
| `infras` | Compose／运维骨架 |
| `./dev` | 唯一本地入口 |

包管理：pnpm@11.27.0。Node ≥ 24。monorepo 名 `gzgt`。

`./dev up` 拉起当前档。`GZGT_PROFILE=dev`（默认）是开发档，使用开发镜像并挂载源码。`GZGT_PROFILE=integration` 是联调档，使用制品镜像。`./dev down` 停容器但保留数据卷。`./dev health backend|frontend|db|minio|doc-render` 检查已拉起的档。`db migrate`、`lint`、`test unit`、`build`、`check` 仍以非 0 退出。

本地占位变量见 `.env.example`。仓库不提交 `.env`。

栈：后端 Nest 12、Prisma 7.10；前端 React 19、Redux Toolkit、Tailwind 4、Vite 7。认证预留本地 argon2 与 IdP 口。数据卷边界见 `infras/README.md`。

权威指针：

- `BC6GdlshqoCOGWx1ENycorbGnSe`｜v0.1.8-r12｜§14｜https://my.feishu.cn/docx/BC6GdlshqoCOGWx1ENycorbGnSe#doxcnqI2jjl8Y493O7dQgP1X2Vg
- `BC6GdlshqoCOGWx1ENycorbGnSe`｜v0.1.8-r12｜§8｜https://my.feishu.cn/docx/BC6GdlshqoCOGWx1ENycorbGnSe#doxcnMnLUshaY4uR6LP0DLe77mb
- `AegldNoYDoshn9xOPbGcWaZinPg`｜v0.1.2｜§2.1｜https://my.feishu.cn/docx/AegldNoYDoshn9xOPbGcWaZinPg#doxcnYGFZQNBP3aBJPRptUhYw5f
- `AegldNoYDoshn9xOPbGcWaZinPg`｜v0.1.2｜§3.A｜https://my.feishu.cn/docx/AegldNoYDoshn9xOPbGcWaZinPg#doxcnDLTHZ6l2cAfaSjwe42WoQb
- `AegldNoYDoshn9xOPbGcWaZinPg`｜v0.1.2｜§3.B｜https://my.feishu.cn/docx/AegldNoYDoshn9xOPbGcWaZinPg#doxcnX6PJlvSfSlcmOAIFflIXDM
- `GO1SdsqW0otXIbxNxwScC8DXnsc`｜v0.1.1｜最小断言表｜https://my.feishu.cn/docx/GO1SdsqW0otXIbxNxwScC8DXnsc#doxcnOImnbHL435kIsRgcxQervb
- `AuzJdFfmRo2OLex0qDTcsXVHnvb`｜v0.9｜§4｜https://my.feishu.cn/docx/AuzJdFfmRo2OLex0qDTcsXVHnvb#doxcnxzzNwrgkSUJpY0WyBTfpOK
- `AuzJdFfmRo2OLex0qDTcsXVHnvb`｜v0.9｜§7｜https://my.feishu.cn/docx/AuzJdFfmRo2OLex0qDTcsXVHnvb#doxcnol1d1lSYnapl2tqIaXN9yh
