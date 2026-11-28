import { useState } from 'react'
import { Badge, Layout, Tabs, Typography } from 'antd'
import type { TabsProps } from 'antd'
import type { NearbyQueryDto } from '@ne/contracts'
import { useHealthQuery } from './api.js'
import NearbyPanel from './components/NearbyPanel.js'
import EvidencePanel from './components/EvidencePanel.js'
// @gen:page-import

// 默认查询：广州市中心（市政府一带），半径 8km 覆盖全部种子点位
const DEFAULT_QUERY: NearbyQueryDto = { lat: 23.1291, lng: 113.2644, radiusM: 8000 }

function resolveInitialTab(items: NonNullable<TabsProps['items']>): string {
  if (typeof window === 'undefined') return 'points'
  const requested = new URLSearchParams(window.location.search).get('tab')
  if (requested && items.some((item) => item.key === requested)) return requested
  return 'points'
}

export default function App() {
  const [query, setQuery] = useState<NearbyQueryDto>(DEFAULT_QUERY)
  const { data: health } = useHealthQuery(undefined, { pollingInterval: 10_000 })

  const items: NonNullable<TabsProps['items']> = [
    { key: 'points', label: '执法点位', children: <NearbyPanel query={query} onQueryChange={setQuery} /> },
    { key: 'evidence', label: '证据文件', children: <EvidencePanel /> },
    // @gen:page-item
  ]

  return (
    <Layout className="h-full">
      <Layout.Header className="flex items-center gap-3">
        <Typography.Title level={4} style={{ color: 'var(--ant-color-white)', margin: 0 }}>
          自然执法 · 执法点位
        </Typography.Title>
        <Badge
          status={health?.status === 'ok' ? 'success' : 'error'}
          text={health?.status === 'ok' ? 'api 在线' : 'api 不可达'}
        />
      </Layout.Header>
      <Layout.Content className="p-4">
        <Tabs defaultActiveKey={resolveInitialTab(items)} items={items} />
      </Layout.Content>
    </Layout>
  )
}
