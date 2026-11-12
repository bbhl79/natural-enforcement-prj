// 用途：判定验证传输地址是否为获准的直连客户端，并探测主机端口可达性。
// 用法：由 check-identity-prep.cjs 与 shell 脚本调用；也可直接以 node 运行做单次探测。
// 退出码：0 可达；1 传输偏离或不可达；2 缺少地址。
/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const { URL } = require('node:url');
const net = require('node:net');

// 解析地址并分类：nginx 主机名与 compose 别名不算获准客户端。
function classifyTransport(baseUrl) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return { ok: false, reason: 'invalid-url', host: '', port: '' };
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  if (host === 'nginx' || host.endsWith('.nginx')) {
    return { ok: false, reason: 'compose-nginx', host, port };
  }
  if (host !== 'localhost' && !host.includes('.') && !host.includes(':')) {
    return { ok: false, reason: 'compose-alias', host, port };
  }
  return { ok: true, reason: 'declared-client', host, port };
}

// 3 秒内探测主机端口能否建立 TCP 连接；超时与出错都返回 false。
function probe(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port: Number(port) });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(3000);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

// 先分类地址，再按解析出的主机与端口做可达探测；host.docker.internal 需显式给探测 IP。
async function checkTransport(baseUrl, probeIp) {
  const verdict = classifyTransport(baseUrl);
  if (!verdict.ok) return verdict;
  const target = verdict.host === 'host.docker.internal' ? String(probeIp || '') : verdict.host;
  if (verdict.host === 'host.docker.internal' && target === '') {
    return { ok: false, reason: 'missing-host-ip', host: verdict.host, port: verdict.port };
  }
  const open = await probe(target, verdict.port);
  if (!open) {
    return { ok: false, reason: 'unreachable', host: target, port: verdict.port };
  }
  return { ok: true, reason: 'reachable', host: target, port: verdict.port };
}

// 命令行入口：接收 URL 与可选探测 IP，打印判定结果或按失败退出。
async function main() {
  const url = process.argv[2];
  const probeIp = process.argv[3] || '';
  if (!url) {
    console.error('[BLOCKED] 缺少传输地址');
    process.exit(2);
  }
  const verdict = await checkTransport(url, probeIp);
  if (!verdict.ok) {
    console.error(`[BLOCKED] 传输偏离。原因 ${verdict.reason}。目标 ${verdict.host || url}。`);
    process.exit(1);
  }
  console.log(JSON.stringify(verdict));
}

module.exports = { classifyTransport, checkTransport };

if (require.main === module) {
  main().catch((error) => {
    console.error(`[BLOCKED] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
