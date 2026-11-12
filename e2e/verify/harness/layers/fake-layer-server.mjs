#!/usr/bin/env node
// 用途：提供验证专用假图层服务，按线索首点经度返回 success／partial／duplicate／clear 场景的图层事实。
// 用法：由 apply-layer-overlay.sh 在容器内启动，或由 protocol-self-check.mjs 以子进程拉起。
// 端口与监听地址由 VERIFY_LAYER_PORT、VERIFY_LAYER_HOST 指定。
// 验证专用假图层服务。
// 协议与 backend/case/src/clue/verification/layer-service-port.ts 的默认适配器一致：
//   GET /query?layer={图层键}&geometry={线索几何 GeoJSON}&srid=4490
//   200，GeoJSON FeatureCollection。
//   要素含 id、geometry、properties.intersection、properties.total_area、properties.overlap_area。
// 不落客户图层，不写客户服务地址。几何只用来选择夹具场景，服务不在本地做空间套合。
//
// 场景按线索面首点经度分带（登记时属性会被产品剥掉，只能看坐标）：
//   [113.2, 113.3) success    七层都有相交，相交比例 1
//   [113.3, 113.4) partial    前三层有相交且相交比例 0.25，后四层无相交
//   [113.4, 113.5) duplicate  与 success 相同的图层事实（查重由线索几何自己产生）
//   其他           clear      七层都返回空要素（无相交，仍是查成）

import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

/** 与 VERIFICATION_LAYERS 同序。协议自检会对照产品名册。 */
export const LAYER_KEYS = [
  'permanent-farmland',
  'ecological-redline',
  'urban-development-boundary',
  'cultivated-land',
  'land-conversion-approval',
  'construction-land-permit',
  'land-supply-redline',
];

/** 部分命中：这三层返回部分相交，其余四层返回空要素。 */
const PARTIAL_KEYS = new Set(LAYER_KEYS.slice(0, 3));

const PORT = Number(process.env.VERIFY_LAYER_PORT ?? '8099');
const HOST = process.env.VERIFY_LAYER_HOST ?? '0.0.0.0';

/** 从查询几何读首点经度。读不出即 NaN。 */
function firstLongitude(geometryText) {
  try {
    const parsed = JSON.parse(geometryText);
    const ring = parsed?.coordinates?.[0];
    const point = Array.isArray(ring) ? ring[0] : null;
    const lon = Array.isArray(point) ? Number(point[0]) : Number.NaN;
    return Number.isFinite(lon) ? lon : Number.NaN;
  } catch {
    return Number.NaN;
  }
}

/** 夹具场景名。 */
export function sceneOfGeometry(geometryText) {
  const lon = firstLongitude(geometryText);
  if (lon >= 113.2 && lon < 113.3) return 'success';
  if (lon >= 113.3 && lon < 113.4) return 'partial';
  if (lon >= 113.4 && lon < 113.5) return 'duplicate';
  return 'clear';
}

// 从查询几何取 Polygon 环；形状不符时返回空环，面积事实仍按场景数字回。
function geometryOf(geometryText) {
  try {
    const parsed = JSON.parse(geometryText);
    if (parsed && parsed.type === 'Polygon' && Array.isArray(parsed.coordinates)) {
      return { type: 'Polygon', coordinates: parsed.coordinates };
    }
  } catch {
    // 几何不是单个 Polygon 时，要素几何留空环。面积事实仍按场景数字回。
  }
  return { type: 'Polygon', coordinates: [] };
}

// 组装一条图层要素：id、几何与相交／总面积属性。
function feature(layerKey, geometry, overlapArea, featureArea) {
  const featureId = `vf-${layerKey}`;
  return {
    id: featureId,
    geometry,
    properties: {
      id: featureId,
      intersection: geometry,
      total_area: featureArea,
      overlap_area: overlapArea,
    },
  };
}

/** 按场景组装一层的 FeatureCollection。 */
export function collectionFor(layerKey, geometryText) {
  const scene = sceneOfGeometry(geometryText);
  const geometry = geometryOf(geometryText);
  if (scene === 'partial') {
    if (PARTIAL_KEYS.has(layerKey)) {
      return { type: 'FeatureCollection', features: [feature(layerKey, geometry, 250, 1000)] };
    }
    return { type: 'FeatureCollection', features: [] };
  }
  if (scene === 'success' || scene === 'duplicate') {
    return { type: 'FeatureCollection', features: [feature(layerKey, geometry, 1000, 1000)] };
  }
  return { type: 'FeatureCollection', features: [] };
}

// 回写 GeoJSON 响应并带上 content-type 与内容长度。
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/geo+json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://verify-layers.local');
  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { ok: true, layers: LAYER_KEYS });
    return;
  }
  if (req.method !== 'GET' || url.pathname !== '/query') {
    sendJson(res, 404, { error: 'not-found' });
    return;
  }
  const layer = url.searchParams.get('layer') ?? '';
  const geometry = url.searchParams.get('geometry') ?? '';
  const srid = url.searchParams.get('srid') ?? '';
  if (srid !== '4490') {
    sendJson(res, 400, { error: 'srid' });
    return;
  }
  if (!LAYER_KEYS.includes(layer)) {
    sendJson(res, 404, { error: 'layer' });
    return;
  }
  const body = collectionFor(layer, geometry);
  const scene = sceneOfGeometry(geometry);
  console.log(JSON.stringify({ layer, scene, features: body.features.length, srid }));
  sendJson(res, 200, body);
});

const launchedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (launchedDirectly) {
  server.listen(PORT, HOST, () => {
    console.log(JSON.stringify({ event: 'listen', host: HOST, port: PORT }));
  });
}
