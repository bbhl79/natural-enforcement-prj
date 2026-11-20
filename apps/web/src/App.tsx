import { useState } from 'react'
import { Badge, Layout, Tabs, Typography } from 'antd'
import type { NearbyQueryDto } from '@ne/contracts'
import { useHealthQuery } from './api.js'
import NearbyPanel from './components/NearbyPanel.js'
import EvidencePanel from './components/EvidencePanel.js'
// @gen:page-import — devenv gen page 在此标记下一行注入 import

const DEFAULT_QUERY: NearbyQueryDto = { lat: 39.9087, lng: 116.3975, radiusM: 3000 }

export default function App() {
  const [query, setQuery] = useState<NearbyQueryDto>(DEFAULT_QUERY)
  const { data: health } = useHealthQuery(undefined, { pollingInterval: 10_000 })

  const items = [
    { key: 'points', label: '执法点位', children: <NearbyPanel query={query} onQueryChange={setQuery} /> },
    { key: 'evidence', label: '证据上传', children: <EvidencePanel /> },
    // @gen:page-item — devenv gen page 在此标记下一行注入 Tab 项
  ]

  return (
    <Layout className="h-full">
      <Layout.Header className="flex items-center gap-3">
        <Typography.Title level={4} style={{ color: 'var(--ant-color-white)', margin: 0 }}>
          执法点位原型（#12 纵切二）
        </Typography.Title>
        <Badge
          status={health?.status === 'ok' ? 'success' : 'error'}
          text={health?.status === 'ok' ? 'api 在线' : 'api 不可达'}
        />
      </Layout.Header>
      <Layout.Content className="p-4">
        <Tabs defaultActiveKey="points" items={items} />
      </Layout.Content>
    </Layout>
  )
}
