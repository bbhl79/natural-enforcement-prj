#!/usr/bin/env node
// e2e 读写通道校验器（e2e/cases/02-readwrite-channel.sh 调用，_ 前缀 + 非 .sh：不作用例执行）。
// 读通道：/testdata 显式只读挂载内的 fixture 必须可读且 expect 字段逐字一致；
// 写通道：校验结果写入 /results（显式读写挂载），宿主侧再断言产物内容。
const fs = require('node:fs');

const fixture = JSON.parse(fs.readFileSync('/testdata/channel-fixture.json', 'utf8'));
if (fixture.expect !== '自然执法工程 e2e 读写通道 fixture') {
  throw new Error(`fixture expect 字段不符：${fixture.expect}`);
}

const result = {
  case: fixture.case,
  readChannel: 'ok',
  fixtureExpectVerified: true,
  writeChannel: 'ok',
  generatedAt: new Date().toISOString(),
};
fs.writeFileSync('/results/readwrite-channel.json', JSON.stringify(result, null, 2) + '\n');
console.log('读写通道校验完成：fixture 读通，结果产物已写 /results/readwrite-channel.json');
