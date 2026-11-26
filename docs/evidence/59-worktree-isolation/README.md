# #59 per-worktree 运行资源隔离 — Windows（WSL2）验收证据

日期：2026-11-25 ｜ 机器：Windows WSL2 + Rancher Desktop podman machine（rootful，
`podman-root.sock`）｜ 代码：`feat/worktree-isolation-59` @ a714ecd

本目录留存 #59 验收标准第 2/3/4 条的实证（命令 + 退出码 + 原始输出）。
验收标准第 1 条（容器/卷/网络/凭据独立、镜像共享）由本目录 05/09/11 与
`devenv/test/isolation-offline.test.sh`（27 离线用例）共同覆盖。

## 文件索引

| 文件 | 内容 |
| --- | --- |
| 00-prep-doctor.txt | 开工前 doctor（exit 0；含 legacy-project warn 实证） |
| 01-legacy-note.txt | 遗留共享项目处置决策（不删除，归 #75；与本场景零干扰） |
| 02-a-build.jsonl / .stderr.txt | A（本 worktree）`--json build`（exit 0） |
| 03-a-up.jsonl / .stderr.txt | A `up`（exit 0；项目 natural-enforcement-90e22128） |
| 04-a-seed.jsonl / .stderr.txt | A `seed`（exit 0，幂等种子） |
| 05-a-baseline.txt | A 基线标记：容器名/创建时间、镜像绑定 ID、凭据指纹 |
| 06-a-sentinel-insert.txt | A 哨兵行插入（EnforcementPoint，广州坐标点） |
| 07-a-markers-before.txt | A 数据/访问地址标记：哨兵行、总行数=6、api 健康 uptime=144 |
| 08-b-scenario.txt | B worktree（ne-59-evidence-b，项目 …-a1648842）完整执行 build→up→migrate→down，逐步 exit 0 |
| 09-a-after-b.txt | **B 全流程后 A 复验**：容器/镜像绑定/凭据指纹/哨兵行/行数/health(uptime=228) 全部不变 |
| 10-cycles-summary.txt + 10-cycle*.log | down/up ×3 循环：每轮 up→doctor→verify→test 全 exit 0；轮间数据保留；末轮 down --volumes 后重建干净 |
| 11-image-sharing.txt | 镜像共享实证：A/B 各自构建，tools 不可变 image ID 逐位相同（d6fb667…）；附 2026-11-26 口径修正（当时 A 采纳镜像未打 wt tag，"两个 tag 指向同一 ID"措辞不准） |
| 12-idempotence.txt | up×2 / migrate×2 / seed×2 / build×2 重复执行 exit 0 |
| 13-interrupt-resume.txt | build 中断（kill -9）后重跑续跑实证（含失效锁清理） |
| 14-b-doctor.txt | B worktree doctor：独立项目/凭据状态可见 |
| 15-final-state.txt + 15-final-up.* | 终态一致性：api 运行镜像 == 状态绑定 image ID |
| 16-fresh-hit-retag.txt + 16-lint*.* | 2026-11-26 复审修复验证：第 2 次 lint 双 fresh 命中（tools.fresh + workspace.fresh），两个 wt-90e22128 tag inspect 成功且与状态登记一致 |

## 关键结论

1. **A 保持运行、B 全流程不影响 A**（09）：B 在其独立项目 natural-enforcement-a1648842
   内完成 build→up→migrate→down 后，A 的容器（同一批容器，created 时间戳不变）、
   镜像绑定（afac4403…/d6fb667…）、数据库凭据指纹（43bf354f…）、哨兵行与总行数、
   api 访问地址与健康（uptime 144→228，同一进程未重启）均无变化。
2. **幂等启停**（10）：down/up ×3，每轮 doctor/verify/集成 test 全绿；不带 volumes
   的 down 保留数据（下一轮 up 后哨兵行仍在，见 10 中各 cycle up 的 sentinel_count=1）；
   `down --volumes` 后重建为干净环境（哨兵行消失、迁移重新应用）。
3. **重复执行幂等**（12）：up/migrate/seed/build 各 ×2 均 exit 0。
4. **中断续跑**（13）：build 中途 kill -9，失效 stack 锁被识别清理，重跑 exit 0。
5. **镜像按不可变产物共享**（11）：A、B 独立构建的 tools 镜像 ID 逐位相同
   （同输入哈希 → 同内容寻址 ID），共享由 image ID 与状态登记证明；per-worktree
   tag 的归属登记在 #84 评审修复后已覆盖新鲜度采纳路径（见 ADR 决策节）。
6. **遗留共享项目**（00/01）：doctor 如实 warn 其存在；本场景未删除它（不属任何
   worktree，回收归 #75），且证明其运行不影响 A/B 隔离。

## 旁证说明（如实）

- A 侧每次命令前若工作树有新增文件（本目录证据文件本身进快照），workspace 镜像
  按 #58 机制重建（秒级，层缓存）；tools 镜像输入未变全程零重建。这属机制正确
  行为，不是缺陷。
- 10-cycle1/2 的 "down 后哨兵数" 为空：down 后 db 停止，查询命令报"服务未就绪"
  属预期——数据保留的证据是**下一轮 up 后** sentinel_count=1（日志可见）。
- 取证时（2026-11-25）A 的 tools 镜像无 `wt-90e22128` tag：首次 build 时 tools
  输入与此前会话完全一致 → 新鲜度命中直接采纳既有不可变镜像，未触发构建故未打
  tag。**该缺口属 #84 评审发现的真实缺陷，已在 PR 上修复**：新鲜度命中路径现
  执行 `docker tag <不可变 ID> <wt tag>`（失败显式 exit 4），见
  `devenv/lib/stack.sh register_local_image_tag` 与 ADR 决策/选项节；
  本机验证见 16-fresh-hit-retag.txt。原文"非缺陷"口径作废。
- B worktree（ne-59-evidence-b）为取证所建，证据固化后已删除（见 PR 说明），
  隔离结论不依赖其留存。
