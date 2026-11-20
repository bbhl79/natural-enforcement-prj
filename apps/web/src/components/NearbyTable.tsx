import { Table } from 'antd'
import type { EnforcementPointDto } from '@ne/contracts'
import { formatDistance } from '../lib/format.js'

// 纯展示组件（props 驱动，可脱离网络单测）
export default function NearbyTable({ points, loading }: { points: EnforcementPointDto[]; loading: boolean }) {
  return (
    <Table<EnforcementPointDto>
      rowKey="id"
      size="small"
      loading={loading}
      dataSource={points}
      pagination={false}
      columns={[
        { title: '名称', dataIndex: 'name' },
        { title: '距离', dataIndex: 'distanceM', render: (v) => formatDistance(v), defaultSortOrder: 'ascend', sorter: (a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0) },
        { title: '纬度', dataIndex: 'lat', render: (v: number) => v.toFixed(4) },
        { title: '经度', dataIndex: 'lng', render: (v: number) => v.toFixed(4) },
      ]}
    />
  )
}
