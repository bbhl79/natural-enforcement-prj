// 把超长期 transferred_out peer 插入当前开发库。
// 只插入。不改写已有行的时间戳。
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { ageYears, isAncient } from './ancient-peer-age.cjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const fixturePath = path.join(
  root,
  '.cursor/skills/verify-natural-enforcement/fixtures/seeds/vf-hist-ancient-peer.json',
);
const sqlPath = path.join(
  root,
  '.cursor/skills/verify-natural-enforcement/fixtures/seeds/vf-hist-ancient-peer.sql',
);

const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PLAIN = /^[^'\n]{1,200}$/;

const GUANGZHOU_BAND = { minLon: 113, maxLon: 114.2, minLat: 22.9, maxLat: 23.4 };
const SALT_BAND = { minLon: 118, maxLon: 121, minLat: 27.8, maxLat: 30.2 };

/**
 * @param {string} label
 * @param {string} value
 * @param {RegExp} pattern
 */
function expectMatch(label, value, pattern) {
  if (!pattern.test(value)) throw new Error(`${label} 不符合夹具格式`);
}

/**
 * @param {unknown} value
 * @returns {value is { type: string, coordinates: number[][][] }}
 */
function isPolygon(value) {
  if (typeof value !== 'object' || value === null) return false;
  const row = /** @type {{ type?: unknown, coordinates?: unknown }} */ (value);
  if (row.type !== 'Polygon' || !Array.isArray(row.coordinates)) return false;
  const ring = row.coordinates[0];
  if (!Array.isArray(ring) || ring.length < 4) return false;
  for (const point of ring) {
    if (!Array.isArray(point) || point.length < 2) return false;
    if (typeof point[0] !== 'number' || typeof point[1] !== 'number') return false;
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) return false;
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1];
}

/**
 * @param {{ minLon: number, maxLon: number, minLat: number, maxLat: number }} band
 * @param {number[][]} ring
 */
function overlapsBand(band, ring) {
  const lons = ring.map((point) => point[0]);
  const lats = ring.map((point) => point[1]);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  return minLon <= band.maxLon && maxLon >= band.minLon && minLat <= band.maxLat && maxLat >= band.minLat;
}

/**
 * @param {Record<string, unknown>} fixture
 */
export function validateFixture(fixture) {
  const code = String(fixture.code ?? '');
  const idempotencyKey = String(fixture.idempotencyKey ?? '');
  const requestDigest = String(fixture.requestDigest ?? '');
  const status = String(fixture.status ?? '');
  const disposition = String(fixture.disposition ?? '');
  const recordedAt = String(fixture.recordedAt ?? '');
  const registeredAt = String(fixture.registeredAt ?? '');
  const sourceCode = String(fixture.sourceCode ?? '');
  const domain = String(fixture.domain ?? '');
  const actorCode = String(fixture.actorCode ?? '');
  const enteredOrgCode = String(fixture.enteredOrgCode ?? '');
  const narrative = String(fixture.narrative ?? '');
  const location = String(fixture.location ?? '');
  const transferredOrg = String(fixture.transferredOrg ?? '');
  const documentNo = String(fixture.documentNo ?? '');
  const note = String(fixture.note ?? '');
  const minAgeYears = fixture.minAgeYears;
  const ids = /** @type {Record<string, unknown>} */ (fixture.ids ?? {});

  expectMatch('code', code, /^CL[0-9]{10}$/);
  expectMatch('idempotencyKey', idempotencyKey, /^vf-seed-hist-ancient-transferred-out$/);
  expectMatch('requestDigest', requestDigest, /^vf-seed-hist-ancient-peer$/);
  if (status !== 'transferred_out') throw new Error('status 必须是 transferred_out');
  if (disposition !== 'transfer') throw new Error('disposition 必须是 transfer');
  expectMatch('recordedAt', recordedAt, INSTANT);
  if (registeredAt !== recordedAt) throw new Error('registeredAt 必须与 recordedAt 相同');
  if (typeof minAgeYears !== 'number' || minAgeYears !== 4) throw new Error('minAgeYears 必须是 4');
  const instantMs = Date.parse(recordedAt);
  if (!isAncient(instantMs, Date.now(), minAgeYears)) {
    throw new Error('recordedAt 距今不足 4 年');
  }
  expectMatch('sourceCode', sourceCode, /^[0-9]{1,4}$/);
  if (domain !== 'land') throw new Error('domain 必须是 land');
  expectMatch('actorCode', actorCode, /^P-[A-Z0-9-]+$/);
  expectMatch('enteredOrgCode', enteredOrgCode, /^ORG-[A-Z0-9-]+$/);
  for (const [label, value] of [
    ['narrative', narrative],
    ['location', location],
    ['transferredOrg', transferredOrg],
    ['documentNo', documentNo],
    ['note', note],
  ]) {
    expectMatch(label, value, PLAIN);
    if (value.includes('__')) throw new Error(`${label} 含占位符`);
  }
  const idOf = {
    clue: String(ids.clue ?? ''),
    spatialObject: String(ids.spatialObject ?? ''),
    spatialPart: String(ids.spatialPart ?? ''),
    disposition: String(ids.disposition ?? ''),
    locationValue: String(ids.locationValue ?? ''),
    session: String(ids.session ?? ''),
  };
  const seen = new Set();
  for (const [label, value] of Object.entries(idOf)) {
    expectMatch(label, value, ULID);
    if (seen.has(value)) throw new Error(`${label} 与其他主键重复`);
    seen.add(value);
  }
  if (!isPolygon(fixture.polygon)) throw new Error('polygon 不是闭合面');
  const ring = fixture.polygon.coordinates[0];
  if (overlapsBand(GUANGZHOU_BAND, ring) || overlapsBand(SALT_BAND, ring)) {
    throw new Error('polygon 与既有示意带或盐移带相交');
  }
  const geojson = JSON.stringify(fixture.polygon);
  if (geojson.includes("'") || geojson.includes('__')) throw new Error('polygon 文本不安全');

  return {
    code,
    idempotencyKey,
    requestDigest,
    status,
    disposition,
    recordedAt,
    sourceCode,
    domain,
    actorCode,
    enteredOrgCode,
    narrative,
    location,
    transferredOrg,
    documentNo,
    note,
    minAgeYears,
    ageYears: ageYears(instantMs, Date.now()),
    ids: idOf,
    geojson,
  };
}

/**
 * @param {string} sql
 * @param {ReturnType<typeof validateFixture>} fixture
 */
export function fillSql(sql, fixture) {
  const pairs = [
    ['__CLUE_ID__', fixture.ids.clue],
    ['__OBJECT_ID__', fixture.ids.spatialObject],
    ['__PART_ID__', fixture.ids.spatialPart],
    ['__DISPOSITION_ID__', fixture.ids.disposition],
    ['__VALUE_ID__', fixture.ids.locationValue],
    ['__SESSION_ID__', fixture.ids.session],
    ['__CODE__', fixture.code],
    ['__IDEMPOTENCY_KEY__', fixture.idempotencyKey],
    ['__REQUEST_DIGEST__', fixture.requestDigest],
    ['__RECORDED_AT__', fixture.recordedAt],
    ['__STATUS__', fixture.status],
    ['__DISPOSITION__', fixture.disposition],
    ['__SOURCE_CODE__', fixture.sourceCode],
    ['__DOMAIN__', fixture.domain],
    ['__ACTOR_CODE__', fixture.actorCode],
    ['__ORG_CODE__', fixture.enteredOrgCode],
    ['__NARRATIVE__', fixture.narrative],
    ['__LOCATION__', fixture.location],
    ['__TRANSFERRED_ORG__', fixture.transferredOrg],
    ['__DOCUMENT_NO__', fixture.documentNo],
    ['__NOTE__', fixture.note],
    ['__GEOJSON__', fixture.geojson],
  ];
  const ordered = [...pairs].sort((left, right) => right[0].length - left[0].length);
  let filled = sql;
  for (const [token, value] of ordered) {
    if (!filled.includes(token)) throw new Error(`SQL 缺少 ${token}`);
    filled = filled.split(token).join(value);
  }
  if (/__[A-Z0-9_]+__/.test(filled)) throw new Error('SQL 仍有未替换占位符');
  if (/\bUPDATE\b/i.test(filled)) throw new Error('SQL 含 UPDATE');
  return filled;
}

const FAILURE_TEXT = {
  'missing-actor': '开发库没有人员 P-CLERK-A。先执行 ./dev up。',
  'missing-org': '开发库没有机构 ORG-DEPT-A。先执行 ./dev up。',
  'missing-clue': '夹具行没有写入。先确认 ./dev up 已完成迁移和开发种子。',
  'code-mismatch': '同键行的业务编号与夹具不一致。本脚本不改写已有行。',
  'missing-disposition': '夹具行没有处置。本脚本不改写已有行。',
  'missing-spatial': '夹具行没有面。本脚本不改写已有行。',
  'status-mismatch': '同键行的状态不是 transferred_out。本脚本不改写已有行。',
  'disposition-mismatch': '同键行的处置不是 transfer。本脚本不改写已有行。',
  'recorded-at-mismatch': '同键行的 disposition.recorded_at 与夹具时刻不一致。本脚本不改写已有行。',
  'registered-at-mismatch': '同键行的 registered_at 与夹具时刻不一致。本脚本不改写已有行。',
  'recorded-at-not-ancient': '同键行的 disposition.recorded_at 距今不足 4 年。本脚本不改写已有行。',
  'registered-at-not-ancient': '同键行的 registered_at 距今不足 4 年。本脚本不改写已有行。',
  'geometry-mismatch': '同键行的面与夹具多边形不一致。本脚本不改写已有行。',
  'bad-srid': '同键行的几何不是 EPSG:4490。本脚本不改写已有行。',
  'bad-geometry-type': '同键行的几何不是面。本脚本不改写已有行。',
  'overlap-below-threshold': '同键行的面在历史查重口径下重叠比例低于 0.6。本脚本不改写已有行。',
};

/**
 * @param {string} sql
 */
function applySql(sql) {
  const result = spawnSync(
    './dev',
    [
      'exec',
      '-T',
      'db',
      'sh',
      '-c',
      'psql -X -q -tA -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f -',
    ],
    {
      cwd: root,
      input: sql,
      encoding: 'utf8',
    },
  );
  if (result.error) {
    throw new Error(`无法执行 ./dev exec db。${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = `${result.stderr ?? ''}${result.stdout ?? ''}`.trim();
    throw new Error(detail === '' ? `psql 退出 ${result.status ?? 'signal'}` : detail);
  }
  const line = (result.stdout ?? '')
    .split('\n')
    .map((item) => item.trim())
    .find((item) => item.startsWith('vf-hist-ancient-peer|'));
  if (!line) throw new Error('播种没有返回核对行');
  return line;
}

/**
 * @param {string} line
 */
function parseCheck(line) {
  const parts = line.split('|');
  const verdict = parts[1] ?? '';
  if (verdict !== 'ok') {
    const text = FAILURE_TEXT[verdict] ?? `播种核对失败：${verdict || line}`;
    throw new Error(text);
  }
  return {
    applied: true,
    verdict: 'ok',
    status: parts[2] ?? '',
    recordedAt: parts[3] ?? '',
    registeredAt: parts[4] ?? '',
    srid: parts[5] ?? '',
    geometryType: parts[6] ?? '',
    selfRatio: parts[7] ?? '',
  };
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const fixture = validateFixture(JSON.parse(readFileSync(fixturePath, 'utf8')));
  const sql = fillSql(readFileSync(sqlPath, 'utf8'), fixture);
  if (checkOnly) {
    if (!sql.includes(fixture.code) || !sql.includes(fixture.ids.clue)) {
      throw new Error('替换后的 SQL 缺少夹具标识');
    }
    if (!sql.includes('ST_Transform') || !sql.includes(fixture.geojson)) {
      throw new Error('替换后的 SQL 缺少几何');
    }
    console.log(
      JSON.stringify({
        check: 'ok',
        code: fixture.code,
        status: fixture.status,
        recordedAt: fixture.recordedAt,
        ageYears: Number(fixture.ageYears.toFixed(3)),
        minAgeYears: fixture.minAgeYears,
      }),
    );
    return;
  }
  const row = parseCheck(applySql(sql));
  const body = {
    ...row,
    code: fixture.code,
    fixtureRecordedAt: fixture.recordedAt,
    ageYears: Number(fixture.ageYears.toFixed(3)),
  };
  const runDir = process.env.VERIFY_RUN_DIR;
  if (runDir) writeFileSync(path.join(runDir, 'seed-result.json'), `${JSON.stringify(body, null, 2)}\n`);
  console.log(JSON.stringify(body));
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[FAIL] ${message}`);
    const runDir = process.env.VERIFY_RUN_DIR;
    if (runDir && !process.argv.includes('--check')) {
      writeFileSync(
        path.join(runDir, 'summary.json'),
        `${JSON.stringify(
          {
            verdict: 'failed',
            kind: 'seed-failed',
            anyAncientPeerInHist: false,
            noLookbackVerified: false,
            message,
          },
          null,
          2,
        )}\n`,
      );
    }
    process.exit(1);
  }
}
