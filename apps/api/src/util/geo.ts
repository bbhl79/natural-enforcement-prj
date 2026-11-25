// 纯地理计算（单元测试覆盖；与 PostGIS ST_Distance 互证）
export type LatLng = { lat: number; lng: number }

const EARTH_RADIUS_M = 6_371_000

/** 大圆距离（球面近似）；PostGIS geography 默认 use_spheroid=true，差值通常 <0.6% */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number): number => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}
