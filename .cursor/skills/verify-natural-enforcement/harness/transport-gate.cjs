'use strict';

const { URL } = require('node:url');
const net = require('node:net');

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
