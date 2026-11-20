// 证据上传闭环（打通 #11 的 BullMQ + rustfs 链路）：
// 浏览器原始字节上传 → api 入队 → worker 取对象算 sha256 回写 → 前端轮询 pending→ready。
// 注：presigned URL（/evidence/:id/url）指向容器内网地址，浏览器不可达——下载走同源代理 /:id/content。
import { useState } from 'react'
import { Alert, App as AntApp, Button, Card, Descriptions, InputNumber, Tag, Typography, Upload } from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd'
import { useGetEvidenceQuery, useUploadEvidenceMutation } from '../api.js'
import { formatBytes, shortSha } from '../lib/format.js'

const STATUS_TAG: Record<string, { color: string; label: string }> = {
  pending: { color: 'processing', label: 'pending（队列处理中）' },
  ready: { color: 'success', label: 'ready（sha256 已回写）' },
  failed: { color: 'error', label: 'failed' },
}

export default function EvidencePanel() {
  const { message } = AntApp.useApp()
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [pointId, setPointId] = useState<number | null>(null)
  const [recordId, setRecordId] = useState<string | null>(null)
  const [uploadEvidence, { isLoading: uploading, error: uploadError }] = useUploadEvidenceMutation()
  const file = fileList[0]
  // pending 期间 1.5s 轮询；终态停轮询（BullMQ 往返的 UI 侧观察窗）
  const { data: record } = useGetEvidenceQuery(recordId ?? '', {
    skip: !recordId,
    pollingInterval: recordId ? 1500 : 0,
  })

  const upload = async () => {
    if (!file?.originFileObj) return
    const bytes = await file.originFileObj.arrayBuffer()
    const r = await uploadEvidence({ name: file.name, pointId, bytes }).unwrap()
    setRecordId(r.id)
    message.success(`已上传并入队：${r.id}`)
  }

  const tag = record ? (STATUS_TAG[record.status] ?? { color: 'default', label: record.status }) : null

  return (
    <Card size="small" title="证据上传（octet-stream → BullMQ → rustfs → sha256 回写）" className="max-w-2xl">
      <Upload.Dragger
        maxCount={1}
        beforeUpload={(f) => {
          // 返回 false 阻止 antd 自动上传；手工构造受控列表项以保留 originFileObj
          setFileList([{ uid: f.uid, name: f.name, originFileObj: f }])
          return false
        }}
        onRemove={() => setFileList([])}
        fileList={fileList}
      >
        <p className="text-2xl">
          <InboxOutlined />
        </p>
        <p>点击或拖入文件（任意类型，原始字节上传）</p>
      </Upload.Dragger>

      <div className="mt-4 flex items-center gap-3">
        <InputNumber
          placeholder="关联点位 ID（可选）"
          min={1}
          value={pointId ?? undefined}
          onChange={(v) => setPointId(typeof v === 'number' ? v : null)}
        />
        <Button type="primary" disabled={!file} loading={uploading} onClick={upload}>
          上传并入队
        </Button>
        {record?.status === 'pending' && <span className="text-xs opacity-60">轮询处理状态…</span>}
      </div>

      {uploadError && (
        <Alert
          className="mt-3"
          type="error"
          showIcon
          message={`上传失败：${JSON.stringify((uploadError as { data?: unknown }).data ?? uploadError)}`}
        />
      )}

      {record && (
        <Descriptions className="mt-4" size="small" bordered column={1}>
          <Descriptions.Item label="记录 ID">
            <Typography.Text copyable style={{ fontSize: 12 }}>
              {record.id}
            </Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="状态">{tag && <Tag color={tag.color}>{tag.label}</Tag>}</Descriptions.Item>
          <Descriptions.Item label="原始文件名">{decodeURIComponent(record.originalName)}</Descriptions.Item>
          <Descriptions.Item label="字节数">{formatBytes(record.bytes)}</Descriptions.Item>
          <Descriptions.Item label="sha256（worker 回写）">
            <Typography.Text code>{shortSha(record.sha256)}</Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="内容回读">
            <Typography.Link href={`/evidence/${record.id}/content`} target="_blank">
              /evidence/{record.id}/content（同源代理）
            </Typography.Link>
          </Descriptions.Item>
        </Descriptions>
      )}
    </Card>
  )
}
