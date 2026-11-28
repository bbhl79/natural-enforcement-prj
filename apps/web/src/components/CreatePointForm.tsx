import { useId } from 'react'
import { Button, Card, Form, Input, InputNumber, App as AntApp } from 'antd'
import { useCreatePointMutation } from '../api.js'

type FormValues = { name: string; lat: number; lng: number }

export default function CreatePointForm() {
  const formId = useId()
  const [form] = Form.useForm<FormValues>()
  const { message } = AntApp.useApp()
  const [createPoint, { isLoading }] = useCreatePointMutation()

  return (
    <Card size="small" title="新建执法点位（写路径：POST → 真实插入，nearby 自动重查）">
      <Form
        form={form}
        name={formId}
        layout="inline"
        onFinish={async (v) => {
          const r = await createPoint(v).unwrap()
          message.success(`已创建点位 #${r.id}（nearby 已自动失效重查）`)
          form.resetFields()
        }}
      >
        <Form.Item name="name" label="名称" rules={[{ required: true, max: 200 }]}>
          <Input style={{ width: 200 }} />
        </Form.Item>
        <Form.Item name="lat" label="纬度" rules={[{ required: true }]}>
          <InputNumber min={-90} max={90} step={0.0001} style={{ width: 120 }} />
        </Form.Item>
        <Form.Item name="lng" label="经度" rules={[{ required: true }]}>
          <InputNumber min={-180} max={180} step={0.0001} style={{ width: 120 }} />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={isLoading}>
            创建
          </Button>
        </Form.Item>
      </Form>
    </Card>
  )
}
