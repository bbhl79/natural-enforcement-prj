// 登记一块与超长期 peer 重叠的新线索，读 historicalGroups，断言年龄不少于 4 年。
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AuthGateError } from './auth-gate.cjs';
import { ageYears, isAncient, parseRegisteredAt } from './ancient-peer-age.mjs';
import { loadIdentity } from './load-fixtures.ts';
import { SessionCache } from './session.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const fixturePath = path.join(
  root,
  '.cursor/skills/verify-natural-enforcement/fixtures/seeds/vf-hist-ancient-peer.json',
);

interface AncientFixture {
  readonly code: string;
  readonly status: string;
  readonly minAgeYears: number;
  readonly polygon: { readonly type: string; readonly coordinates: number[][][] };
}

interface HistoricalGroup {
  readonly otherClueCode: string;
  readonly otherStatus: string;
  readonly disposedAt: string;
  readonly otherRegisteredAt: string;
  readonly disposition: string | null;
  readonly disposedAgeYears: number | null;
  readonly registeredAgeYears: number | null;
}

interface Summary {
  readonly verdict: 'passed' | 'failed' | 'blocked';
  readonly kind: string;
  readonly anyAncientPeerInHist: boolean;
  readonly noLookbackVerified: boolean;
  readonly fixtureCode: string;
  readonly newClueId: string | null;
  readonly historicalGroupCount: number;
  readonly activeGroupCount: number;
  readonly peer: HistoricalGroup | null;
  readonly message: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function listOf(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = asRecord(item);
    return row === null ? [] : [row];
  });
}

function runDir(): string {
  return process.env.VERIFY_RUN_DIR ?? path.join(root, '.run/verify-hist-dup-no-lookback');
}

function writeSummary(summary: Summary): void {
  writeFileSync(path.join(runDir(), 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
}

function loadFixture(): AncientFixture {
  const raw = JSON.parse(readFileSync(fixturePath, 'utf8')) as Record<string, unknown>;
  const polygon = asRecord(raw.polygon);
  const minAgeYears = raw.minAgeYears;
  if (typeof raw.code !== 'string' || typeof raw.status !== 'string') {
    throw new Error('夹具缺少 code 或 status');
  }
  if (typeof minAgeYears !== 'number') throw new Error('夹具缺少 minAgeYears');
  if (polygon === null || !Array.isArray(polygon.coordinates)) throw new Error('夹具缺少 polygon');
  return {
    code: raw.code,
    status: raw.status,
    minAgeYears,
    polygon: polygon as AncientFixture['polygon'],
  };
}

function groupOf(row: Record<string, unknown>, nowMs: number): HistoricalGroup {
  const disposedAt = asText(row.disposedAt);
  const otherRegisteredAt = asText(row.otherRegisteredAt);
  const disposedMs = Date.parse(disposedAt);
  const registeredMs = parseRegisteredAt(otherRegisteredAt);
  return {
    otherClueCode: asText(row.otherClueCode),
    otherStatus: asText(row.otherStatus),
    disposedAt,
    otherRegisteredAt,
    disposition: row.disposition === null || row.disposition === undefined ? null : asText(row.disposition),
    disposedAgeYears: Number.isFinite(disposedMs) ? ageYears(disposedMs, nowMs) : null,
    registeredAgeYears: registeredMs === null ? null : ageYears(registeredMs, nowMs),
  };
}

function isTerminal(status: string): boolean {
  return status === 'closed' || status === 'transferred_out';
}

async function registerOverlapping(
  baseUrl: string,
  cookie: string,
  fixture: AncientFixture,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const received = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const form = new FormData();
  form.set('sourceCode', '16');
  form.set('domain', 'land');
  form.set('types', 'land_occupy_without_approval');
  form.set('confirm', 'true');
  form.set('subjectUnknown', 'false');
  form.set('anonymityConfirmed', 'false');
  form.set('srid', '4326');
  form.set(
    'values',
    JSON.stringify({
      'clue.received_at': received,
      'clue.narrative': 'vf-无回溯上限探测。与超长期终态 peer 重叠。',
      'clue.finder': 'vf-巡查员甲',
      'clue.patrol_no': 'vf-XC-HIST-ANCIENT',
      'type.land_occupy_without_approval.subject_name': 'vf-当事人甲',
      'type.land_occupy_without_approval.occurrence_time': '2018-06-01',
      'type.land_occupy_without_approval.boundary': 'vf-合成界址说明',
      'type.land_occupy_without_approval.actual_area': '100',
    }),
  );
  const feature = { type: 'Feature', geometry: fixture.polygon, properties: {} };
  form.set(
    'spatial-source',
    new Blob([JSON.stringify(feature)], { type: 'application/geo+json' }),
    'area.geojson',
  );
  const idem = `vf-probe-hist-ancient-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const response = await fetch(`${baseUrl}/api/clues`, {
    method: 'POST',
    headers: { cookie, 'idempotency-key': idem },
    body: form,
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(text);
    body = asRecord(parsed) ?? { raw: text };
  } catch {
    body = { raw: text };
  }
  return { status: response.status, body };
}

async function main(): Promise<number> {
  const fixture = loadFixture();
  const baseUrl = process.env.VERIFY_BASE_URL ?? 'https://localhost:8080';
  const nowMs = Date.now();
  const identity = await loadIdentity('clerk-a');
  const sessions = new SessionCache(baseUrl);
  let cookie = '';
  try {
    cookie = await sessions.cookieOf(identity);
  } catch (error) {
    const reason = error instanceof AuthGateError ? error.reason : 'auth-rejected';
    const summary: Summary = {
      verdict: 'blocked',
      kind: reason,
      anyAncientPeerInHist: false,
      noLookbackVerified: false,
      fixtureCode: fixture.code,
      newClueId: null,
      historicalGroupCount: 0,
      activeGroupCount: 0,
      peer: null,
      message: error instanceof Error ? error.message : String(error),
    };
    writeSummary(summary);
    console.log(JSON.stringify(summary));
    return 2;
  }

  const registered = await registerOverlapping(baseUrl, cookie, fixture);
  const newClueId = asText(registered.body.id);
  if ((registered.status !== 200 && registered.status !== 201) || asText(registered.body.result) !== 'registered' || newClueId === '') {
    const summary: Summary = {
      verdict: 'failed',
      kind: 'register-failed',
      anyAncientPeerInHist: false,
      noLookbackVerified: false,
      fixtureCode: fixture.code,
      newClueId: newClueId === '' ? null : newClueId,
      historicalGroupCount: 0,
      activeGroupCount: 0,
      peer: null,
      message: `登记 HTTP ${registered.status}。${JSON.stringify(registered.body).slice(0, 500)}`,
    };
    writeSummary(summary);
    console.log(JSON.stringify(summary));
    return 1;
  }

  const duplicate = await fetch(`${baseUrl}/api/clues/${newClueId}/duplicates`, { headers: { cookie } });
  const duplicateText = await duplicate.text();
  let duplicateBody: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(duplicateText);
    duplicateBody = asRecord(parsed) ?? { raw: duplicateText };
  } catch {
    duplicateBody = { raw: duplicateText };
  }
  if (duplicate.status !== 200) {
    const summary: Summary = {
      verdict: 'failed',
      kind: 'duplicate-http',
      anyAncientPeerInHist: false,
      noLookbackVerified: false,
      fixtureCode: fixture.code,
      newClueId,
      historicalGroupCount: 0,
      activeGroupCount: 0,
      peer: null,
      message: `查重 HTTP ${duplicate.status}。${duplicateText.slice(0, 500)}`,
    };
    writeSummary(summary);
    console.log(JSON.stringify(summary));
    return 1;
  }

  const historical = listOf(duplicateBody.historicalGroups).map((row) => groupOf(row, nowMs));
  const ancient = historical.filter((group) => {
    if (!isTerminal(group.otherStatus) || group.disposedAgeYears === null) return false;
    const disposedMs = Date.parse(group.disposedAt);
    return isAncient(disposedMs, nowMs, fixture.minAgeYears);
  });
  const peer =
    ancient.find((group) => {
      if (group.otherClueCode !== fixture.code || group.otherStatus !== fixture.status) return false;
      if (group.registeredAgeYears === null) return false;
      const registeredMs = parseRegisteredAt(group.otherRegisteredAt);
      return registeredMs !== null && isAncient(registeredMs, nowMs, fixture.minAgeYears);
    }) ?? null;
  const anyAncientPeerInHist = ancient.length > 0;
  const noLookbackVerified = peer !== null && anyAncientPeerInHist;
  const summary: Summary = {
    verdict: noLookbackVerified ? 'passed' : 'failed',
    kind: noLookbackVerified ? 'no-lookback-verified' : 'ancient-peer-missing',
    anyAncientPeerInHist,
    noLookbackVerified,
    fixtureCode: fixture.code,
    newClueId,
    historicalGroupCount: historical.length,
    activeGroupCount: listOf(duplicateBody.groups).length,
    peer,
    message: noLookbackVerified
      ? 'historicalGroups 含超长期终态 peer。'
      : 'historicalGroups 没有年龄不少于 4 年的夹具 peer。',
  };
  writeSummary(summary);
  console.log(JSON.stringify(summary));
  return noLookbackVerified ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    const summary: Summary = {
      verdict: 'failed',
      kind: 'probe-error',
      anyAncientPeerInHist: false,
      noLookbackVerified: false,
      fixtureCode: '',
      newClueId: null,
      historicalGroupCount: 0,
      activeGroupCount: 0,
      peer: null,
      message: error instanceof Error ? error.message : String(error),
    };
    try {
      writeSummary(summary);
    } catch {
      // 证据目录不可写时仍把原因打到 stderr。
    }
    console.error(`[FAIL] ${summary.message}`);
    process.exit(1);
  });
