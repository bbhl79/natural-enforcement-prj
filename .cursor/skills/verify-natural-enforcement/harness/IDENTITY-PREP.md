# 身份准备（与验证跑分离）

本文件只描述获准的身份准备。
验证跑的脚本不调用本准备。
准备不得接在同一次验证跑后面。
同一次 `.run/verify-*` 一旦 `blocked`，结果不得入账。

## 期望来源（harness 配置，不是产品白名单）

产品 `SourceGate` 没有允许来源配置。
实现文件是 `backend/server/src/source-gate.ts`。
本 PR 不改该文件。
计数只在该进程内存里。
空地址不进入计数。
封锁满 30 分钟后自行解除。
闸生效时登录返回 401。
正文是 `{ "result": "invalid-credential" }`。
该正文与口令错误相同。
审计动作 `login.source-limited` 不出现在响应正文。
依据是 `docs/adr/0011-认证留痕写入共用表.md` 与 `integration/login-lock.test.ts`。
取地址只采信单跳 `X-Forwarded-For`。
否则使用套接字对端地址。
nginx 写入的是它看见的 TCP 对端。
依据是 `backend/server/src/session-cookie.ts` 与 `infra/nginx/default.conf`。

harness 的期望客户端如下。
UI 使用 `host.docker.internal`。
`--add-host` 指向 `VF_HOST_IP` 或宿主网卡地址。
该地址必须能到达 nginx 监听端口。
API 跑次使用 `VERIFY_BASE_URL`。
未设置时使用 `https://localhost:8080`。
对端地址与 `VF_HOST_IP` 数值不同，可以是一跳映射。
一跳映射不是换源。
`BASE_URL` 的主机名为 `nginx` 或其他无点的 compose 服务名时，传输门禁记 `blocked`。
`host.docker.internal` 不可达时，传输门禁记 `blocked`。
脚本不得改走其他地址继续同一次跑。

因此本 harness 不能从 401 正文单独证明来源受限。
登录响应不是 200 时，driver 立即 `blocked` 并退出。
正文含 `login.source-limited`、`source-limited` 或 `来源受限` 时，原因记为 `source-limited`。
其余登录失败原因记为 `auth-rejected`。
两种原因都停止当前跑次。
允许来源若要做成产品配置，只能另开产品票。
该票必须和重启清内存分开。
本文件不实施该建议。

## 可重复夹具种子

准备只在验证跑之外进行。
准备使用仓库既有开发种子 `backend/prisma/seed.mjs`。
口令更换只走产品登录接口或管理员重置接口。
本文件不写清库步骤。
本文件不写 SQL 改密步骤。
本文件不写清 Redis 步骤。
本文件不写重启步骤。
本文件不写加入 compose 网络的步骤。
操作者在准备前保存 `before.json`。
操作者在准备后保存 `after.json`。
两份文件的 `takenAt` 必须不同。
快照记录 git tip、容器 id、容器 `startedAt`、health、来源 IP、身份元数据。
快照不写口令。
快照不写口令散列。
快照目录不得位于 `.run/verify-*`。
检查命令只读这两份文件。

```bash
bash .cursor/skills/verify-natural-enforcement/harness/check-identity-prep.sh <快照目录>
```

检查通过后，操作者才能开始下一次新的验证跑。
上一次 `blocked` 的证据保持作废。
新跑次只消费准备好的一个登录口令。
设置了 `VERIFY_LOGIN_PASSWORD` 时，使用该值。
未设置时，使用身份夹具的种子口令。
跑内不试第二个口令。
跑内不改人员记录。
跑内不清锁定。
登录已经成功，且产品要求更换口令时，允许提交这一次产品更换。
该更换不是绕过 `SourceGate`。
更换失败则停止。

快照形状见 `identity-prep-snapshot.example.json`。
`latestAuthAction` 可写 `login.source-limited` 或 `null`。
`passwordChangedAt` 只记时间。
