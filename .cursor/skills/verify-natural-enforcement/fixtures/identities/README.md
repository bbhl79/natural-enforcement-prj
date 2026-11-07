# 身份夹具

对照开发库种子人员（`backend/prisma/seed.mjs` 开发测试夹具段）固化。
`e2e/cases/04-first-login.sh` 使用其中的 `e2e-first-login`（手机号 `13800001010`）。

口令与种子共用同一测试口令，**不写明文**。本地任选其一：

```bash
# 环境变量
export VERIFY_PASSWORD_SEED='<与 backend/prisma/seed.mjs 中 SEED_PASSWORD 相同>'

# 或本地 secrets（该文件不进 git）
mkdir -p .run
printf '%s\n' '{"seed":"<与 SEED_PASSWORD 相同>"}' > .run/verify-secrets.local.json
```

## 清单

| id | 种子工号 | 角色 | 显示名 | 手机号 |
| ---- | ---- | ---- | ---- | ---- |
| `admin-a` | P-SUP-A | 系统管理 | 甲主管 | 13800001001 |
| `admin-hq` | P-ADMIN-HQ | 系统管理 | 市局管理 | 13800001231 |
| `clerk-a` | P-CLERK-A | 经办 | 乙经办 | 13800001002 |
| `clerk-b` | P-CLERK-B | 经办 | 丙经办 | 13800001003 |
| `intake-hq` | P-INTAKE-HQ | 内勤 | 市局内勤 | 13800001004 |
| `intake-a` | P-INTAKE-A（integration 种入） | 内勤 | 甲区内勤 | 13900002001 |
| `intake-st` | P-INTAKE-ST（integration 种入） | 内勤 | 甲所内勤 | 13900002003 |
| `handler-st1` | P-HANDLER-ST1（integration 种入） | 经办 | 甲所主办甲 | 13900002004 |
| `legal-st` | P-LEGAL-ST | 法制审核 | 甲所法制 | 13800001005 |
| `review-a` | P-REVIEW-A | 行政审核 | 甲区审核 | 13800001006 |
| `approve-hq` | P-APPROVE-HQ | 行政审批 | 市局审批 | 13800001007 |
| `super-b` | P-SUPER-B | 监督 | 乙区监督 | 13800001008 |
| `both-a` | P-BOTH-A | 监督／经办 | 甲区兼岗 | 13800001009 |
| `e2e-first-login` | P-E2E-99 | 经办 | 首登冒烟 | 13800001010 |
| `super-hq` | P-SUPER-HQ | 监督 | 市局监督 | 13800001011 |

旅程 `identityRefs` 填上表 `id`。

业务跑次只读取本目录和已声明口令。
不得在 scenario 里遍历口令。
身份准备见 `../../harness/IDENTITY-PREP.md`。

不收录 `e2e/cases/06-bootstrap.sh`、`07-day-one.sh` 运行时临时建出的人员；那些账号用例结束即删，不进本目录。

`identity.example.json` 仍是字段模板，不参与跑次引用。
