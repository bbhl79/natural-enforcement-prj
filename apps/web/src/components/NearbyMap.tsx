// 地理特性可视化：/nearby（PostGIS ST_DWithin + ST_Distance）结果 → Leaflet 圆点标记 + 半径圈。
// 瓦片由浏览器自行拉取 OSM（瓦片不可达时标记仍可渲染，仅无底图）。
import { useEffect } from 'react'
import { Circle, CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet'
import type { NearbyResult } from '@ne/contracts'
import { formatDistance } from '../lib/format.js'

function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap()
  useEffect(() => {
    map.setView([lat, lng])
  }, [lat, lng, map])
  return null
}

export default function NearbyMap({ result }: { result?: NearbyResult }) {
  const center: [number, number] = result
    ? [result.center.lat, result.center.lng]
    : [39.9087, 116.3975]
  return (
    <MapContainer center={center} zoom={12} scrollWheelZoom className="h-[440px] w-full rounded">
      <TileLayer
        attribution="&copy; OpenStreetMap contributors"
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {result && (
        <>
          <Recenter lat={result.center.lat} lng={result.center.lng} />
          <Circle center={[result.center.lat, result.center.lng]} radius={result.radiusM} />
          <CircleMarker center={[result.center.lat, result.center.lng]} radius={6} pathOptions={{ color: '#1677ff' }} />
          {result.points.map((p) => (
            <CircleMarker
              key={p.id}
              center={[p.lat, p.lng]}
              radius={8}
              pathOptions={{ color: '#cf1322', fillOpacity: 0.7 }}
            >
              <Tooltip>
                {p.name} · {formatDistance(p.distanceM)}
              </Tooltip>
            </CircleMarker>
          ))}
        </>
      )}
    </MapContainer>
  )
}
