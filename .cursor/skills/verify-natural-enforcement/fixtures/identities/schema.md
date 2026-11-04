# 身份夹具 schema（约定）

字段由人按下列约定填写。本文件只定键名与约束，不定业务枚举值。

## 对象形状

```json
{
  "id": "string — 稳定标识",
  "role": "string — 角色标签",
  "displayName": "string — 显示名占位",
  "mobile": "string — 测试手机号占位",
  "passwordRef": {
    "env": "可选 — 环境变量名",
    "secretsFile": "可选 — 本地 secrets 相对路径（该文件不进 git）",
    "key": "可选 — secrets 文件内键名"
  },
  "notes": "可选 — 备注"
}
```

## 硬约束

- 禁止把生产／个人真实口令明文写入本目录任何文件。
- `mobile` 使用测试号段或虚构号，禁止个人真实号码。
- `passwordRef` 至少提供 `env` 或 `secretsFile`+`key` 之一。
