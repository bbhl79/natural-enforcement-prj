# Research：rustfs 成熟度与容器部署调研

- 票：#2（Research-rustfs成熟度与容器部署调研）
- 日期：2026-11-16
- 调研方法：所有结论回溯一手来源（GitHub API、官方文档、Docker Hub、官方 issue 跟踪器、HN 一手讨论），二手分析仅作旁证并注明。

---

## 一、结论先行

**推荐：采用 rustfs 作为本项目（devenv 开发环境 + e2e 体系）唯一对象存储，单节点模式、锁定具体版本 tag（当前 `rustfs/rustfs:1.0.6`，2026-11-15 发布）。** 同时把所有对象访问收敛到一个 NestJS storage 适配模块，把 rustfs 的可替换性控制在"改配置即切换"的程度。

理由（按权重排序）：

1. **四个候选中唯一同时满足硬性条件的**：官方 Docker 镜像活跃维护（最新 tag 与最新 release 同日推送）+ 本项目关键特性（presigned URL、multipart upload、bucket policy）在官方 Ceph s3tests 门禁中验证通过 + Apache-2.0 许可 + 迭代速度极快（月度多次发布）。
2. **MinIO 社区版已死**：仓库 2026-04-25 被归档，声明 "THIS REPOSITORY IS NO LONGER MAINTAINED"，社区版仅剩源码分发、旧二进制不再更新。作为容器基座已不可选（无维护镜像 = 供应链与安全风险）。
3. **风险可控且被架构隔离**：本项目对 rustfs 的使用形态是"dev/e2e 单节点、数据可丢弃"，恰好规避了 rustfs 当前问题最集中的分布式锁与升级路径；生产部署本就在地图 out-of-scope 内。

**定性判断：可用于本项目的 dev/e2e 场景（推荐采用）；不承诺生产可用。** 项目太年轻（首个 alpha 2026-04-25、GA 2026-09-16，距今仅 2 个月），已知未关闭 issue 集中在分布式锁超时与单节点重负载内存增长，均有规避手段（见风险清单）。

---

## 二、依据与来源

### 2.1 项目本体：活跃度、社区、许可证

| 维度 | 事实 | 来源 |
|---|---|---|
| 定位 | Rust 编写的分布式高性能 S3 兼容对象存储，纠删码（erasure coding），面向 AI/数据湖场景 | [GitHub rustfs/rustfs](https://github.com/rustfs/rustfs)、[ARCHITECTURE.md](https://github.com/rustfs/rustfs/blob/main/ARCHITECTURE.md) |
| 规模 | 36,157 stars / 1,671 forks / 100 贡献者（GitHub API，2026-11-16 实测） | GitHub API `repos/rustfs/rustfs`、`contributors` |
| 许可证 | Apache-2.0（无 AGPL 传染顾虑） | GitHub API `.license.spdx_id` |
| 发布节奏 | 首个 alpha 2026-04-25 → beta（2026-05~07）→ rc（2026-08）→ **1.0.0 GA 2026-09-16** → 1.0.1(10-03) → 1.0.2(10-16) → 1.0.3(10-17) → 1.0.4(10-25) → 1.0.5(11-10) → **1.0.6(11-15)**；主分支最近推送 2026-11-16（当天） | GitHub API `releases` |
| 背后团队 | 中国团队，依托 2024 年成立的公司实体运营；2025-07 开源；加入 NVIDIA Inception（2026-04）；Rust Foundation 赞助方；无公开融资 | [Mr.PlanB 评估](https://www.mrplanb.com/reports/object-storage-ledger-2026/rustfs)、[NVIDIA Inception 公告](https://rustfs.com/blog/big-news-rustfs-joins-the-nvidia-inception-program)、[HN 讨论](https://news.ycombinator.com/item?id=46326984) |
| 自报采用 | 32,000+ stars、3.7M+ 实例、1,000 万+ 镜像拉取、160+ 贡献者 | [1.0.0 GA 公告](https://rustfs.com/blog/announcing-rustfs-1-0-0-ga)（**自报数字，无第三方审计，仅作参考**） |
| 开源承诺 | 公开承诺核心仓库永久 Apache-2.0 | [承诺帖](https://rustfs.com/blog/a-safe-harbor-for-the-future-rustfss-unwavering-commitment-to-open-source) |

要点：star 增速异常快（7 个月 3.6 万），社区（HN）对营销声明确有质疑，但仓库本体 commit/release 活跃度与 issue 响应（见 2.4）是一手可验证的。

### 2.2 官方 Docker 镜像与维护状态

- 镜像：`rustfs/rustfs`（[Docker Hub](https://hub.docker.com/r/rustfs/rustfs)，[rustfs 组织页](https://hub.docker.com/u/rustfs)），共 218 个 tag；`latest` 与 `1.0.6`/`1.0.6-glibc` 同批推送于 2026-11-15；**每个版本 tag 均同步官方 release 发布，无滞后**。
- 双变体：默认 tag 为 musl 构建（体积小），`-glibc` 变体另发；均支持 linux/amd64 与 linux/arm64（含 WSL2 的 amd64）。来源：Docker Hub tags API（2026-11-16 实测）。
- 官方容器文档（[docs.rustfs.com](https://docs.rustfs.com/en/installation/container/docker)）关键事实：
  - 端口：9000（S3 API）/ 9001（Console 管理台）；
  - 配置：`RUSTFS_ACCESS_KEY` / `RUSTFS_SECRET_KEY` / `RUSTFS_ADDRESS=":9000"` / `RUSTFS_CONSOLE_ADDRESS=":9001"` / `RUSTFS_CONSOLE_ENABLE=true`，数据目录以位置参数传入（如 `/data`）；
  - **容器以非 root 用户 `rustfs`（UID 10001）运行**：bind mount 宿主目录必须先 `chown -R 10001:10001`，官方 docker-compose 用 `rustfs_perms` init 容器在启动前 chown；用 named volume 则无此问题；
  - 健康检查：`curl --fail http://localhost:9000/health`；
  - 默认凭证 `rustfsadmin/rustfsadmin`，文档明确要求创建时即改；修改凭证需重建容器（数据卷保留）；
  - 要求 Docker Engine ≥ 20.10；仓库自带 [docker-compose.yml](https://github.com/rustfs/rustfs/blob/main/docker-compose.yml)。
- 单节点即一条 `docker run -d -p 9000:9000 -p 9001:9001 -v rustfs-data:/data -e RUSTFS_ACCESS_KEY=... -e RUSTFS_SECRET_KEY=... rustfs/rustfs:1.0.6 /data`，完全契合"宿主机只存代码、运行时全在容器"的硬不变量。

### 2.3 S3 API 兼容度（官方兼容矩阵，一手）

来源：[S3 Compatibility Matrix](https://docs.rustfs.com/en/reference/s3-compatibility)（真相源为仓库内 [s3-compatibility-matrix.md](https://github.com/rustfs/rustfs/blob/main/docs/architecture/s3-compatibility-matrix.md) 与 `scripts/s3-tests`）。测试基座是 **Ceph s3tests 可执行用例清单**，当前对 rustfs commit `1e6f5f1e` 验证：

| 清单 | 用例数 | 含义 |
|---|---|---|
| implemented_tests | 455 | 默认门禁，应全过 |
| lifecycle_behavior_tests | 5 | 生命周期专属门禁 |
| unimplemented_tests | 17 | 计划实现，不阻塞 |
| excluded_tests | 270 | 有意排除 |

**本项目关键特性逐项核验：**

| 特性 | 状态 | 依据 |
|---|---|---|
| Presigned URL | ✅ GET/PUT 均在门禁通过；JS/Python SDK 文档有生成示例 | 兼容矩阵 + [JS SDK 文档](https://docs.rustfs.com/en/developer/sdk/javascript)、[Python SDK 文档](https://docs.rustfs.com/en/developer/sdk/python) |
| Multipart upload | ✅ Create / UploadPart / Complete / Abort 通过（含部分 copy/checksum/object-attribute 用例）；**列举 multipart 与 part 查询的边缘用例被有意排除** | 兼容矩阵 |
| Bucket policy | ✅ bucket policy / tagging / public access block 通过 | 兼容矩阵 |
| 版本控制 / Object Lock / CORS / 生命周期 | ✅ "Selected versioning, Object Lock, CORS, and lifecycle behavior"（清单内用例） | 兼容矩阵 |
| SSE | ✅ SSE-C 与部分 SSE-KMS（**仅 RustFS 自管对象往返，加密格式不跨实现移植**） | 兼容矩阵 |
| 认证协议 | AWS Signature V4；AWS CLI / boto3 / JS / Rust / Java SDK 官方文档验证 | [S3 协议文档](https://docs.rustfs.com/en/administration/protocols/s3) |
| ACL 授权 | ❌ **"Intentionally unsupported product behavior"**（有意不支持） | 兼容矩阵 |
| Bucket access logging / ownership controls / POST Object 表单 checksum | ❌ 未实现（17 条计划中） | 兼容矩阵 |
| 附加 API | WebDAV、Swift、SFTP、FTPS、（预览）S3 Tables/Iceberg REST | [仓库 README](https://github.com/rustfs/rustfs) |

注意：README 特性表中的桶复制/站点复制、ILM 分层、IAM/OIDC、多租户等标 ✅，但兼容矩阵页未覆盖复制类用例（矩阵注明通用 S3 目标仅支持 PUT/HEAD/DELETE + multipart）。本项目不依赖复制，不受影响。

### 2.4 已知坑（全部为一手 GitHub issue，截至 2026-11-16 状态）

**仍 open 的问题（按对本项目相关度排序）：**

| Issue | 现象 | 对本项目影响 |
|---|---|---|
| [#9145](https://github.com/rustfs/rustfs/issues/9145) | 单盘 1.0.4：list/PUT/DeleteObjects 混合负载下匿名内存持续增长不释放，两轮后 1.5GiB OOM；维护者在 ARM64/x86-64 Docker 未复现（同负载峰值 431-824MiB），持续分配剖析调查中 | **直接相关**：e2e 会高频建桶/上传/列举/删桶。缓解：容器内存上限 + 可回收（数据本就可丢弃） |
| [#9028](https://github.com/rustfs/rustfs/issues/9028) | 并发 listObjects 风暴（Flink 初始化）下 503 SlowDownRead + readiness 超时（1.0.4） | 相关：e2e 并发 agent 同时列举时可能撞上；healthcheck 需容忍瞬时 503 |
| [#9329](https://github.com/rustfs/rustfs/issues/9329) | 3 节点分布式：小对象 PUT 间歇 503 `namespace_lock_timeout`，peer 锁/磁盘 RPC 超时 | 不相关：本项目单节点 |
| [#9175](https://github.com/rustfs/rustfs/issues/9175) | ListObjectVersions 对 multipart 对象漏 ETag（破坏 Veeam） | 低相关：若 e2e 断言 multipart 对象的 ETag 会踩坑，断言时应绕开该字段或加兼容分支 |
| [#9196](https://github.com/rustfs/rustfs/issues/9196) | scanner 读周期状态时锁超时 | 低相关 |
| [#9074](https://github.com/rustfs/rustfs/issues/9074) | aarch64 上 beta.10→1.0.1 PUT 吞吐回退 | 低相关：WSL2 为 amd64 |
| [#8013](https://github.com/rustfs/rustfs/issues/8013) | Console(9001) 与 S3 根路径匿名访问一律 AccessDenied（合成 login/session 桶被拒） | 体验问题：健康检查勿依赖 Console；e2e 不要断言 9001 页面 |
| [#5083](https://github.com/rustfs/rustfs/issues/5083) | 分布式模式如何零停机升级（无明确答案） | 不相关：单节点可销毁重建 |

**社区一手评价（HN [46326984](https://news.ycombinator.com/item?id=46326984)）：** 试用者称"underbaked"、文档大量 404、单节点并行写性能欠佳与怪异报错；架构质疑（不用 Raft，自研 dsync 分布式锁、缺架构文档，担忧网络分区下丢已提交写入——团队回应纠删码 + quorum + dsync）；`license.rs` 被指存在商业许可切换伏笔。**我方核查**：仓库确有 `rustfs/src/license.rs` 与 `rustfs/src/connect/license.rs`（Ed25519 验证的服务许可机制），但代码注释明确其服务于 RustFS Connect 商业服务与 OEM entitlement，"has no signing capability and does not affect S3 availability"；核心许可仍为 Apache-2.0 且有公开承诺帖。定性：治理层面需持续观察，非当前阻塞项。

**第三方实测（[Milvus 团队](https://milvus.io/blog/evaluating-rustfs-as-a-viable-s3-compatible-object-storage-backend-for-milvus.md)，基于 1.0.0-alpha.68，结论"experimental，不建议生产"）：** 写吞吐 +57%（4472 vs 2845 行/s）、存储占用省 57%（7.8 vs 18GB）、热加载快 67%；但搜索延迟慢约 3.3 倍（7.96ms vs 1.85ms，波动至 17ms）、索引构建慢 43%。提示 rustfs 性能画像为**写强读弱**——本项目 e2e 规模对此无感，但不要采用"全面优于 MinIO"的营销叙事做决策。

### 2.5 备选对比（许可证/活跃度均为 GitHub 或官方站点一手核验，2026-11-16）

| | rustfs | MinIO 社区版 | SeaweedFS | Garage |
|---|---|---|---|---|
| 许可证 | Apache-2.0 | AGPL-3.0 | Apache-2.0（仓库） | AGPL-3.0 |
| 活跃度 | 主分支当天有推送；月度多版 | **仓库 2026-04-25 归档，"NO LONGER MAINTAINED"，源码-only，旧二进制不更新** | 4.54 当天发布；持续高频 | 活跃（自托管 [Gitea](https://git.deuxfleurs.fr/Deuxfleurs/garage)，v2.5.0 2026-10-23） |
| 规模 | 36.2k stars / 100 贡献者 | 61.3k stars（历史存量） | 36.1k stars / 712 open issues | 社区小（~179 stars / ~2.9k commits / 31 分支） |
| S3 面 | s3tests 门禁 455 用例；presigned/multipart/bucket policy ✅；**ACL 有意不支持** | 历史最全 | S3 网关为无状态转换层（桶→collection、对象→filer），语义有映射差异 | 覆盖面较小，定位轻量 3 副本异地存储 |
| 商业化 | 存在公司实体 + Connect/OEM entitlement；承诺核心 Apache-2.0 | 转向 AIStor Free/Enterprise；2025-06 移除社区版管理 UI 引发信任危机（[报道](https://www.blocksandfiles.com/ai-ml/2025/06/19/minio-users-complain-after-admin-ui-removed-from-community-edition/1610856)、[讨论](https://github.com/minio/minio/discussions/21326)） | 官网推出 Enterprise，[定价页](https://seaweedfs.com/docs/pricing)写明"Production deployments require a paid license regardless of size"（针对 Enterprise 产品线；开源仓库仍 Apache-2.0） | 无商业化，NGI/NLnet 公共资助 |
| 对本项目 | **采用** | 排除（无维护镜像） | 备选 2 | 备选 1（规模/生态最小，但治理最干净） |

来源：GitHub API（`repos/minio/minio`、`repos/seaweedfs/seaweedfs`、minio commits/releases）、[minio/minio README](https://github.com/minio/minio)、[seaweedfs.com/docs/pricing](https://seaweedfs.com/docs/pricing)、[garagehq.deuxfleurs.fr](https://garagehq.deuxfleurs.fr/)、[garage 仓库](https://git.deuxfleurs.fr/Deuxfleurs/garage)。

AGPL 说明：本项目为内部 dev/e2e 工具，不分发、不对外提供网络服务，即使选用 Garage/MinIO 源码，AGPL 的网络条款义务也基本不触发；Apache-2.0 的 rustfs 在这一点上最省心。

---

## 三、风险清单

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R1 | 项目极年轻：alpha 距今约 7 个月，GA 距今 2 个月；第三方实测明确"不建议生产" | 中（dev/e2e 场景降为低） | 本项目仅 dev/e2e 用途且数据可丢弃；生产在地图 out-of-scope，天然隔离 |
| R2 | 单节点重负载内存增长未根治（#9145，open） | 中 | compose 给 rustfs 服务设 mem_limit（建议 1g 起）+ restart 策略；e2e 数据本可回收；升级时回归观察 |
| R3 | 分布式模式锁超时/503（#9329、#9028、#9196） | 低（本项目单节点） | devenv 永远以单节点模式起；文档写死，不做多节点 |
| R4 | 并发 listObjects 风暴触发 503 SlowDownRead（#9028） | 中 | e2e 执行器对列举操作限并发；healthcheck 判定用 /health 而非业务请求；失败重试幂等 |
| R5 | ACL 有意不支持 | 低 | 项目规范：统一 bucket policy + IAM 凭证，禁止依赖 canned ACL 语义（如 x-amz-acl） |
| R6 | ListObjectVersions 对 multipart 对象缺 ETag（#9175） | 低 | e2e 断言不依赖 multipart 对象的 version-ETag 组合字段 |
| R7 | 治理/许可信任：公司实体、license.rs entitlement 钩子、营销夸大（HN 一手质疑） | 低-中（观察项） | 锁镜像 digest；订阅 release 公告；设"许可证变更即触发备选评估"的明确开关（见下） |
| R8 | 镜像 tag 漂移破坏 e2e 确定性（latest 移动快、月度多版） | 中 | 固定 `1.0.6` + 记录 digest；升级走独立 PR + 往返 e2e 毕业演练；禁止 latest |
| R9 | 随机读性能弱（第三方实测约 3-4 倍延迟） | 低（本项目规模无感） | 不以性能为由做设计假设；容量规划不引用厂商数字 |
| R10 | 文档质量差（大量 404，HN 证实） | 低 | devenv 不依赖文档 URL；以仓库内 docs/ 与 docker-compose.yml 为准；关键命令固化进 devenv 代码 |

**备选触发条件（写入工程基座 SPEC 的开关）：** 出现以下任一情况即启动备选评估，顺序 Garage → SeaweedFS：(a) rustfs 出现数据损坏类 issue 且 30 天无修复；(b) 连续 3 个月无 release；(c) 核心许可证变更或闭源化迹象；(d) 单节点内存问题（#9145）在 1.0.7+ 仍未收敛并实际影响 e2e。

---

## 四、对本项目的直接可采用建议

### 4.1 devenv 内 rustfs 服务定义（可直接进 compose，供 devenv 封装）

```yaml
services:
  rustfs:
    image: rustfs/rustfs:1.0.6   # 锁版本；首次拉取后在 devenv 状态文件记录 digest
    ports: ["9000", "9001"]      # 仅容器网络暴露，端口由 devenv 分配；不对宿主暴露
    volumes:
      - rustfs-data:/data        # named volume（规避 UID 10001 bind-mount 权限坑）
    environment:
      RUSTFS_ACCESS_KEY: ${RUSTFS_ACCESS_KEY:?devenv 注入}
      RUSTFS_SECRET_KEY: ${RUSTFS_SECRET_KEY:?devenv 注入}
      RUSTFS_ADDRESS: ":9000"
      RUSTFS_CONSOLE_ADDRESS: ":9001"
      RUSTFS_CONSOLE_ENABLE: "true"
    mem_limit: 1g                # 对冲 #9145
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "curl --fail http://localhost:9000/health || exit 1"]
      interval: 5s
      timeout: 3s
      retries: 12                # 容忍启动期/瞬时 503 SlowDown（#9028）
      start_period: 10s
    command: ["/data"]           # 单节点模式，数据目录位置参数

volumes:
  rustfs-data:
```

要点：不用 bind mount（避开 UID 10001 chown 与 WSL2 文件系统权限交叉问题）；凭证绝不使用默认 rustfsadmin，由 devenv 从本地 secret 注入，不进 git。

### 4.2 NestJS 接入（与兼容矩阵验证面对齐）

- 用 `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`，endpoint `http://rustfs:9000`，`forcePathStyle: true`，region 任意非空值（SigV4 需要）。
- e2e 往返演练至少覆盖：PutObject/GetObject、presigned GET + PUT（真实 HTTP 调用而非仅生成）、multipart ≥2 分片 + Complete + Abort、bucket 创建/删除。这四项恰是官方 s3tests 门禁已验证的路径，属最低风险区。
- 所有 S3 访问收敛到单一 storage 适配模块（endpoint/credentials/bucket 全配置注入），这是对 R1/R7 的架构性保险：替换 rustfs 只改配置与镜像，不改业务代码。

### 4.3 e2e 数据级隔离（对齐地图"基础设施共享、数据隔离"）

- 每次测试运行创建独立 bucket（如 `e2e-<run-id>`），结束强制清理（含 abort 未完成的 multipart upload）；凭证共享、键空间隔离。
- e2e 断言避免依赖：canned ACL、ListObjectVersions 中 multipart 对象的 ETag、Console(9001) 页面行为（见 R5/R6 与 #8013）。

### 4.4 版本与升级策略

- 基线锁 `1.0.6`；升级 = 独立 PR（改 tag + 更新 digest）+ 跑完整 rustfs 往返 e2e 后合入；每次升级检查 #9145、#9028 状态。
- 在 devenv 的 `status`/`doctor` 输出里报告 rustfs 镜像 digest 与版本（agent DX：机器可解析、确定性）。

### 4.5 一句话给 SPEC 的决策记录

> 对象存储采用 rustfs 1.0.x（Apache-2.0，官方镜像活跃，presigned/multipart/bucket policy 经 Ceph s3tests 门禁验证），单节点容器部署于 devenv，mem_limit + 健康检查 + 锁版本；MinIO 社区版已归档停维护故排除；备选 Garage（治理最干净）→ SeaweedFS（注意其企业版商业化边界）；触发条件与切换面收敛在 storage 适配模块。

---

## 附：来源索引

- rustfs 仓库/文档：[github.com/rustfs/rustfs](https://github.com/rustfs/rustfs) · [docker 安装文档](https://docs.rustfs.com/en/installation/container/docker) · [S3 兼容矩阵](https://docs.rustfs.com/en/reference/s3-compatibility) · [S3 协议](https://docs.rustfs.com/en/administration/protocols/s3) · [docker-compose.yml](https://github.com/rustfs/rustfs/blob/main/docker-compose.yml) · [1.0.0 GA 公告](https://rustfs.com/blog/announcing-rustfs-1-0-0-ga) · [开源承诺](https://rustfs.com/blog/a-safe-harbor-for-the-future-rustfss-unwavering-commitment-to-open-source)
- 镜像：[hub.docker.com/r/rustfs/rustfs](https://hub.docker.com/r/rustfs/rustfs)
- 关键 issue：[#9145](https://github.com/rustfs/rustfs/issues/9145) · [#9028](https://github.com/rustfs/rustfs/issues/9028) · [#9329](https://github.com/rustfs/rustfs/issues/9329) · [#9175](https://github.com/rustfs/rustfs/issues/9175) · [#9074](https://github.com/rustfs/rustfs/issues/9074) · [#8013](https://github.com/rustfs/rustfs/issues/8013) · [#5083](https://github.com/rustfs/rustfs/issues/5083)
- 社区/第三方：[HN 46326984](https://news.ycombinator.com/item?id=46326984) · [Milvus 实测](https://milvus.io/blog/evaluating-rustfs-as-a-viable-s3-compatible-object-storage-backend-for-milvus.md) · [Mr.PlanB 评估](https://www.mrplanb.com/reports/object-storage-ledger-2026/rustfs)
- 备选：[minio/minio](https://github.com/minio/minio)（归档态） · [Blocks & Files 报道](https://www.blocksandfiles.com/ai-ml/2025/06/19/minio-users-complain-after-admin-ui-removed-from-community-edition/1610856) · [minio 讨论 #21326](https://github.com/minio/minio/discussions/21326) · [seaweedfs/seaweedfs](https://github.com/seaweedfs/seaweedfs) · [SeaweedFS 定价页](https://seaweedfs.com/docs/pricing) · [Garage 官网](https://garagehq.deuxfleurs.fr/) · [Garage 仓库](https://git.deuxfleurs.fr/Deuxfleurs/garage)
- GitHub API 实测（stars/forks/license/releases/pushed_at/contributors，2026-11-16）：rustfs/rustfs、minio/minio、seaweedfs/seaweedfs
