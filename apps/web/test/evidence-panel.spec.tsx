// 证据面板展示（UI 证据）：unicode 名称原样展示、同源下载链接、绝不渲染内部存储地址。
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { EvidenceRecordDto } from '@ne/contracts'
import { EvidenceDetails } from '../src/components/EvidencePanel.js'

afterEach(cleanup)

const UNICODE_NAME = '广州市执法证据（2026）· 現場照片.jpg'
const RECORD_ID = '0b6c1f60-1f1e-4c55-9a70-1b8e3a7e9d21'

function record(overrides: Partial<EvidenceRecordDto> = {}): EvidenceRecordDto {
  return {
    id: RECORD_ID,
    pointId: null,
    originalName: UNICODE_NAME,
    contentType: 'application/octet-stream',
    bytes: 262144,
    sha256: 'a'.repeat(64),
    status: 'ready',
    error: null,
    createdAt: '2026-11-28T00:00:00.000Z',
    contentPath: `/evidence/${RECORD_ID}/content`,
    ...overrides,
  }
}

describe('EvidenceDetails（同源文件证据展示）', () => {
  it('unicode 文件名原样展示；下载链接是同源 contentPath', () => {
    render(<EvidenceDetails record={record()} />)
    expect(screen.getByTestId('evidence-file-name')).toHaveTextContent(UNICODE_NAME)

    const link = screen.getByTestId('evidence-download')
    expect(link.getAttribute('href')).toBe(`/evidence/${RECORD_ID}/content`)
    expect(link.getAttribute('href')).not.toMatch(/^[a-z]+:\/\//i)
    expect(document.body.innerHTML).not.toContain('rustfs')
    expect(document.body.innerHTML).not.toContain('9000')
  })

  it('ready 状态展示 sha256 与字节数；pending 显示处理中', () => {
    render(<EvidenceDetails record={record()} />)
    expect(screen.getByText('256.0 KiB')).toBeInTheDocument()
    expect(screen.getByText('aaaaaaaaaaaa…')).toBeInTheDocument()
    cleanup()

    render(<EvidenceDetails record={record({ status: 'pending', bytes: null, sha256: null })} />)
    expect(screen.getByText('pending（后台处理中）')).toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
  })

  it('failed 状态展示契约内的通用错误文案（不含内部地址）', () => {
    render(
      <EvidenceDetails
        record={record({ status: 'failed', error: '证据处理失败：无法读取或校验对象' })}
      />,
    )
    expect(screen.getByText('failed')).toBeInTheDocument()
    expect(screen.getByText('证据处理失败：无法读取或校验对象')).toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain('rustfs')
  })
})