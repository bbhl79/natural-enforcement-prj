// 证据上传请求构造（纯函数，可单测）：
// 文件名按线上契约 `x-original-name: encodeURIComponent(name)` 传输；
// 关联点位只在填写时携带。浏览器只走同源 /evidence。
import {
  EVIDENCE_CONTENT_TYPE,
  EVIDENCE_ROUTES,
  encodeOriginalName,
  ORIGINAL_NAME_HEADER,
  POINT_ID_HEADER,
} from '@ne/contracts'

export interface EvidenceUploadInput {
  readonly name: string
  readonly pointId: number | null
  readonly bytes: Uint8Array
}

export interface EvidenceUploadRequest {
  readonly url: string
  readonly method: 'POST'
  readonly body: Uint8Array
  readonly headers: Record<string, string>
}

export function buildEvidenceUploadRequest(input: EvidenceUploadInput): EvidenceUploadRequest {
  const headers: Record<string, string> = {
    'content-type': EVIDENCE_CONTENT_TYPE,
    [ORIGINAL_NAME_HEADER]: encodeOriginalName(input.name),
  }
  if (input.pointId != null) headers[POINT_ID_HEADER] = String(input.pointId)
  return {
    url: EVIDENCE_ROUTES.base,
    method: 'POST',
    body: input.bytes,
    headers,
  }
}