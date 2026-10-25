// 线索中心筛选栏（#207）。
// 六维筛选 + 关键词 + 登记日起止。

import { type ChangeEvent, type FocusEvent } from 'react';

/** 法域选项。 */
const DOMAIN_OPTIONS: readonly { readonly value: string; readonly label: string }[] = [
  { value: '', label: '全部法域' },
  { value: 'land', label: '土地' },
  { value: 'mineral', label: '矿产' },
  { value: 'survey', label: '测绘' },
  { value: 'planning', label: '规划' },
];

/** 环节状态选项。 */
const STATUS_OPTIONS: readonly { readonly value: string; readonly label: string }[] = [
  { value: '', label: '全部状态' },
  { value: 'pending_decision', label: '待分派决定' },
  { value: 'in_pool', label: '待分派池' },
  { value: 'org_assigned', label: '已派机构' },
  { value: 'handler_assigned', label: '已派承办人' },
  { value: 'held', label: '不派' },
  { value: 'transferred_out', label: '已移送' },
  { value: 'closed', label: '已结案' },
  { value: 'filed', label: '已归档' },
];

/** 内业核查状态选项。 */
const CHECK_OPTIONS: readonly { readonly value: string; readonly label: string }[] = [
  { value: '', label: '全部核查' },
  { value: 'not_required', label: '无需核查' },
  { value: 'running', label: '核查中' },
  { value: 'done', label: '已完成' },
  { value: 'failed', label: '未跑成' },
];

/** 缺件状态选项。 */
const GAP_OPTIONS: readonly { readonly value: string; readonly label: string }[] = [
  { value: '', label: '全部缺件' },
  { value: 'has_gap', label: '有缺件' },
  { value: 'no_gap', label: '无缺件' },
];

export interface ClueCenterFiltersValue {
  readonly domain: string;
  readonly source: string;
  readonly org: string;
  readonly status: string;
  readonly check: string;
  readonly gap: string;
  readonly keyword: string;
  readonly from: string;
  readonly to: string;
}

export interface ClueCenterFiltersProps {
  readonly value: ClueCenterFiltersValue;
  readonly onChange: (key: string, value: string) => void;
}

export default function ClueCenterFilters({ value, onChange }: ClueCenterFiltersProps) {
  const selectChange = (key: string) => (e: ChangeEvent<HTMLSelectElement>) => onChange(key, e.target.value);
  const dateChange = (key: string) => (e: ChangeEvent<HTMLInputElement>) => onChange(key, e.target.value);
  const blurChange = (key: string) => (e: FocusEvent<HTMLInputElement>) => onChange(key, e.target.value);

  return (
    <div className="filters">
      <select className="select" value={value.domain} onChange={selectChange('domain')}>
        {DOMAIN_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      <input
        className="input"
        type="text"
        placeholder="来源"
        defaultValue={value.source}
        onBlur={blurChange('source')}
      />
      <input
        className="input"
        type="text"
        placeholder="机构"
        defaultValue={value.org}
        onBlur={blurChange('org')}
      />
      <select className="select" value={value.status} onChange={selectChange('status')}>
        {STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      <select className="select" value={value.check} onChange={selectChange('check')}>
        {CHECK_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      <select className="select" value={value.gap} onChange={selectChange('gap')}>
        {GAP_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      <input
        className="input"
        type="text"
        placeholder="关键词"
        defaultValue={value.keyword}
        onBlur={blurChange('keyword')}
        style={{ width: 200 }}
      />
      <input
        className="input"
        type="date"
        value={value.from}
        onChange={dateChange('from')}
        style={{ width: 140 }}
      />
      <span style={{ color: 'var(--muted)', fontSize: 12 }}>至</span>
      <input
        className="input"
        type="date"
        value={value.to}
        onChange={dateChange('to')}
        style={{ width: 140 }}
      />
    </div>
  );
}