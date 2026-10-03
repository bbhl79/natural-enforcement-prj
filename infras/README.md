唯一树中的 Compose／运维骨架目录。

| 文件 | 用途 |
|---|---|
| `compose.yaml` | 数据库、MinIO、文书渲染 sidecar |
| `compose.dev.yaml` | 开发档：开发镜像，源码挂载 |
| `compose.integration.yaml` | 联调档：制品镜像，不挂源码 |

`./dev` 按 `GZGT_PROFILE` 选择 overlay。默认 `dev`。项目名是 `gzgt-dev` 与 `gzgt-integration`，两档数据卷互不相通。

数据卷边界：

- `./dev down` 停容器并删容器网络，保留数据卷。
- `pgdata` 是数据库数据。删掉这只卷才会清空库。应用镜像重建不碰它。
- `miniodata` 是对象数据。三桶 `dossier`、`doc-render`、`export` 由 `./dev up` 初始化为私有；删掉这只卷才会清空对象。
- 开发档的 `dev_node_modules`、`dev_backend_node_modules`、`dev_frontend_node_modules`、`dev_backend_dist`、`pnpm_store` 是依赖和编译输出。删掉它们只会让下次 `./dev up` 重新安装，不碰数据库和对象。
- 卷的实际名字带项目前缀，例如 `gzgt-dev_pgdata`。

PostGIS 扩展不在这里创建，留给迁移 0001。`./dev health db` 只确认 PostgreSQL 16 在跑，且 PostGIS 3.5 已作为可安装扩展存在。

MinIO 使用 `RELEASE.2025-09-07T16-13-09Z-cpuv1`。同一镜像里带有 `mc`，`./dev up` 用它把三个桶初始化为私有。
