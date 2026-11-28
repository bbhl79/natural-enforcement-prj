// 证据同源往返的 UI（#69）：
// 浏览器原始字节上传 → api 入队 → 后台 worker 回写 sha256/状态 → 前端轮询 pending→ready。
// 下载只经同源 contentPath；UI 不展示/不携带任何内部存储地址或 presigned URL。
import { useEffect, useState } from 'react'
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Descriptions,
  InputNumber,
  Tag,
  Typography,
  Upload,
} from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd'
import type { EvidenceRecordDto } from '@ne/contracts'
import { useGetEvidenceQuery, useUploadEvidenceMutation } from '../api.js'
import { formatBytes, shortSha } from '../lib/format.js'

const STATUS_TAG: Record<string, { color: string; label: string }> = {
  pending: { color: 'processing', label: 'pending（后台处理中）' },
  ready: { color: 'success', label: 'ready（sha256 已回写）' },
  failed: { color: 'error', label: 'failed' },
}

export function EvidenceDetails({ record }: { record: EvidenceRecordDto }) {
  const tag = STATUS_TAG[record.status] ?? { color: 'default', label: record.status }
  return (
    <Descriptions className="mt-4" size="small" bordered column={1}>
      <Descriptions.Item label="记录 ID">
        <Typography.Text copyable style={{ fontSize: 12 }}>
          {record.id}
        </Typography.Text>
      </Descriptions.Item>
      <Descriptions.Item label="原始文件名">
        <span data-testid="evidence-file-name">{record.originalName}</span>
      </Descriptions.Item>
      <Descriptions.Item label="状态">
        <Tag color={tag.color}>{tag.label}</Tag>
      </Descriptions.Item>
      <Descriptions.Item label="字节数">{formatBytes(record.bytes)}</Descriptions.Item>
      <Descriptions.Item label="sha256（worker 回写）">
        <Typography.Text code>{shortSha(record.sha256)}</Typography.Text>
      </Descriptions.Item>
      <Descriptions.Item label="同源下载">
        <Typography.Link
          data-testid="evidence-download"
          href={record.contentPath}
          target="_blank"
          rel="noreferrer"
        >
          {record.contentPath}
        </Typography.Link>
      </Descriptions.Item>
      {record.error && (
        <Descriptions.Item label="错误">
          <Typography.Text type="danger">{record.error}</Typography.Text>
        </Descriptions.Item>
      )}
    </Descriptions>
  )
}

export default function EvidencePanel() {
  const { message } = AntApp.useApp()
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [pointId, setPointId] = useState<number | null>(null)
  const [recordId, setRecordId] = useState<string | null>(null)
  const [polling, setPolling] = useState(false)
  const [uploadEvidence, { isLoading: uploading, error: uploadError }] = useUploadEvidenceMutation()

  // pending 期间 1.5s 轮询；观察到终态即停（避免 ready 后仍定时请求）
  const { data: record } = useGetEvidenceQuery(recordId ?? '', {
    skip: !recordId,
    pollingInterval: polling ? 1500 : 0,
  })
  useEffect(() => {
    if (record && record.status !== 'pending') setPolling(false)
  }, [record])

  const file = fileList[0]?.originFileObj

  const upload = async (): Promise<void> => {
    if (!file) return
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const started = await uploadEvidence({ name: file.name, pointId, bytes }).unwrap()
      setPolling(true)
      setRecordId(started.id)
      message.success(`已上传并入队：${started.originalName}`)
    } catch {
      // 失败态由下方 Alert 统一展示（包含契约错误/网络错误）；避免未处理的 rejection
    }
  }

  return (
    <Card size="small" title="证据文件（原始字节 → 后台 worker → sha256 回写；下载同源）">
      <Upload.Dragger
        maxCount={1}
        beforeUpload={(f) => {
          // 阻止 antd 自动上传；保留 originFileObj 供手工构造原始字节请求
          setFileList([{ uid: f.uid, name: f.name, originFileObj: f }])
          return false
        }}
        onRemove={() => setFileList([])}
        fileList={fileList}
      >
        <p className="text-2xl">
          <InboxOutlined />
        </p>
        <p>点击或拖入文件（任意类型/unicode 文件名，原始字节上传）</p>
      </Upload.Dragger>

      <div className="mt-4 flex items-center gap-3">
        <InputNumber
          placeholder="关联点位 ID（可选）"
          min={1}
          value={pointId ?? undefined}
          onChange={(value) => setPointId(typeof value === 'number' ? value : null)}
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

      {record && <EvidenceDetails record={record} />}
    </Card>
  )
}