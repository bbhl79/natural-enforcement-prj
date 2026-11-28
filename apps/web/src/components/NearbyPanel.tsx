import { useId, useState } from 'react'
import { Alert, Button, Card, Flex, Form, InputNumber, Spin } from 'antd'
import type { NearbyQueryDto } from '@ne/contracts'
import { useNearbyQuery } from '../api.js'
import CreatePointForm from './CreatePointForm.js'
import NearbyMap from './NearbyMap.js'
import NearbyTable from './NearbyTable.js'

type FormValues = { lat: number; lng: number; radiusM: number }

export default function NearbyPanel({
  query,
  onQueryChange,
}: {
  query: NearbyQueryDto
  onQueryChange: (q: NearbyQueryDto) => void
}) {
  const formId = useId()
  const [form] = Form.useForm<FormValues>()
  const [draft, setDraft] = useState<FormValues>(query)
  const { data, isFetching, error } = useNearbyQuery(query)

  return (
    <Flex vertical gap={16}>
      <Card size="small" title="附近点位查询（PostGIS ST_DWithin，距离由 ST_Distance 排序）">
        <Form
          form={form}
          name={formId}
          layout="inline"
          initialValues={draft}
          onValuesChange={(_, v) => setDraft(v)}
          onFinish={() => onQueryChange(draft)}
        >
          <Form.Item name="lat" label="纬度" rules={[{ required: true }]}>
            <InputNumber min={-90} max={90} step={0.0001} style={{ width: 120 }} />
          </Form.Item>
          <Form.Item name="lng" label="经度" rules={[{ required: true }]}>
            <InputNumber min={-180} max={180} step={0.0001} style={{ width: 120 }} />
          </Form.Item>
          <Form.Item name="radiusM" label="半径(米)" rules={[{ required: true }]}>
            <InputNumber min={1} max={100000} step={100} style={{ width: 110 }} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={isFetching}>
              查询
            </Button>
          </Form.Item>
        </Form>
      </Card>

      {error && <Alert type="error" showIcon message={`查询失败：${JSON.stringify((error as { data?: unknown }).data ?? error)}`} />}

      <Flex gap={16} align="flex-start" className="flex-col lg:flex-row">
        <Card size="small" title="地图（红点=命中点位，蓝点=中心，圈=查询半径）" className="flex-1 min-w-0">
          {isFetching && !data ? <Spin /> : <NearbyMap result={data} />}
        </Card>
        <Card size="small" title={`命中 ${data?.points.length ?? 0} 个点位`} className="w-full lg:w-96">
          <NearbyTable points={data?.points ?? []} loading={isFetching} />
        </Card>
      </Flex>

      <CreatePointForm />
    </Flex>
  )
}
