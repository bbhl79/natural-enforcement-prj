// 基本信息与要件页签（#207 线索中心抽屉）。
//
// 展示四块：基本信息区、反映人区（匿名线索不展示）、要件清单区（按层分组）、缺件清单。
// 反映人默认脱敏，有 clue.reference.read 权限可查看实名。
// 缺件项特殊标记，未补齐项可单项补齐或选中多项一键补齐。
// 监督只读时补齐按钮不显示。

import { useState } from 'react';

import type { ReporterReadResult } from './duplicate';
import { maskContact, maskName, type ClueDetail, type ClueGap, type GapFillResult } from './detail';
import { ClueExternalTransferSection } from './ClueExternalTransferSection';
import ClueFilingPanel from './ClueFilingPanel';

/** 将 gaps 值映射到 requirements 上的一条展示行。 */
interface RequirementRow {
  readonly key: string;
  readonly layer: string;
  readonly label: string;
  readonly required: boolean;
  readonly value: string | null;
  /** 这条是缺件项（在 gaps 中）。 */
  readonly isGap: boolean;
  /** 缺件的补齐时间；已补齐则有值，未补齐为 null。仅在 isGap 时有意义。 */
  readonly gapFilledAt: string | null;
}

function buildRows(view: ClueDetail): RequirementRow[] {
  const valueMap = new Map(view.values.map((v) => [v.key, v.value]));
  const gapMap = new Map(view.gaps.map((g) => [g.key, g]));
  return view.requirements.map((req) => {
    const gap = gapMap.get(req.key);
    const value = valueMap.get(req.key) ?? null;
    return {
      key: req.key,
      layer: req.layer,
      label: req.label,
      required: req.required,
      value: value,
      isGap: gap !== undefined,
      gapFilledAt: gap?.filledAt ?? null,
    };
  });
}

/** 要件清单：按层分组，逐项展示。 */
function RequirementsSection({
  rows,
  gapInputs,
  selectedGaps,
  onInputChange,
  onToggleSelect,
  onSingleFill,
  supervisorReadonly,
  busy,
}: {
  readonly rows: RequirementRow[];
  readonly gapInputs: Record<string, string>;
  readonly selectedGaps: Set<string>;
  readonly onInputChange: (key: string, value: string) => void;
  readonly onToggleSelect: (key: string) => void;
  readonly onSingleFill: (key: string) => void;
  readonly supervisorReadonly: boolean;
  readonly busy?: boolean;
}) {
  const layerOrder = ['公共层', '来源层', '类型层'];
  const grouped = new Map<string, RequirementRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.layer);
    if (list) list.push(row);
    else grouped.set(row.layer, [row]);
  }
  const sortedLayers = [...grouped.keys()].sort(
    (a, b) => layerOrder.indexOf(a) - layerOrder.indexOf(b),
  );

  return (
    <div className="card">
      <div className="card-h">要件清单</div>
      {sortedLayers.map((layer) => (
        <div key={layer} className="card">
          <div className="card-h">{layer}</div>
          <table className="table">
            <thead>
              <tr>
                {supervisorReadonly ? null : <th>选</th>}
                <th>要件名</th>
                <th>必填</th>
                <th>取值</th>
                {supervisorReadonly ? null : <th>补齐</th>}
              </tr>
            </thead>
            <tbody>
              {grouped.get(layer)!.map((row) => {
                const isUnfilledGap = row.isGap && row.gapFilledAt === null;
                return (
                  <tr key={row.key} className={isUnfilledGap ? 'row-warn' : undefined}>
                    {supervisorReadonly ? null : (
                      <td>
                        {isUnfilledGap ? (
                          <input
                            type="checkbox"
                            checked={selectedGaps.has(row.key)}
                            onChange={() => onToggleSelect(row.key)}
                            disabled={busy === true}
                          />
                        ) : null}
                      </td>
                    )}
                    <td>
                      {row.label}
                      {isUnfilledGap ? <span className="tag red">缺件</span> : null}
                      {row.isGap && row.gapFilledAt !== null ? (
                        <span className="tag green">已补齐</span>
                      ) : null}
                    </td>
                    <td>{row.required ? '是' : '否'}</td>
                    <td>
                      {row.value !== null ? (
                        row.value
                      ) : row.isGap && row.gapFilledAt === null ? (
                        <span className="err">—</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    {supervisorReadonly ? null : (
                      <td>
                        {isUnfilledGap ? (
                          <span className="form-row">
                            <input
                              className="input"
                              placeholder={`请输入${row.label}`}
                              value={gapInputs[row.key] ?? ''}
                              onChange={(e) => onInputChange(row.key, e.target.value)}
                              disabled={busy === true}
                            />
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              disabled={busy === true || !gapInputs[row.key]}
                              onClick={() => onSingleFill(row.key)}
                            >
                              补齐
                            </button>
                          </span>
                        ) : null}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

/** 缺件清单：区分已补齐和未补齐，常驻展示。 */
function GapsSection({
  gaps,
  unfilledCount,
}: {
  readonly gaps: readonly ClueGap[];
  readonly unfilledCount: number;
}) {
  const filled = gaps.filter((g) => g.filledAt !== null);
  const unfilled = gaps.filter((g) => g.filledAt === null);
  if (gaps.length === 0) return null;
  return (
    <div className="card">
      <div className="card-h">
        缺件清单
        <span className="hint">{`共 ${gaps.length} 项，未补齐 ${unfilledCount} 项`}</span>
      </div>
      {unfilled.length > 0 ? (
        <div>
          <div className="desc">未补齐</div>
          <table className="table">
            <thead>
              <tr>
                <th>要件名</th>
                <th>必填</th>
                <th>时机</th>
                <th>不补后果</th>
              </tr>
            </thead>
            <tbody>
              {unfilled.map((gap) => (
                <tr key={gap.key} className="row-warn">
                  <td>{gap.label}</td>
                  <td>{gap.required ? '是' : '否'}</td>
                  <td>{gap.timing}</td>
                  <td>{gap.consequence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {filled.length > 0 ? (
        <div>
          <div className="desc">已补齐</div>
          <table className="table">
            <thead>
              <tr>
                <th>要件名</th>
                <th>补齐时间</th>
              </tr>
            </thead>
            <tbody>
              {filled.map((gap) => (
                <tr key={gap.key}>
                  <td>{gap.label}</td>
                  <td>{gap.filledAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 基本信息与要件页签。
 * view 为线索详情；onReadReporter 取反映人实名；onGapFill 补齐缺件。
 * supervisorReadonly 为 true 时补齐按钮不渲染，且显示只读说明。
 */
export function ClueBasicTab({
  view,
  onReadReporter,
  onGapFill,
  supervisorReadonly,
  busy,
}: {
  readonly view: ClueDetail;
  readonly onReadReporter?: () => Promise<ReporterReadResult>;
  readonly onGapFill?: (fills: readonly { key: string; value: string }[]) => Promise<GapFillResult>;
  readonly supervisorReadonly?: boolean;
  readonly busy?: boolean;
}) {
  const [reporter, setReporter] = useState<{ name: string | null; contact: string | null } | null>(null);
  const [reporterFailure, setReporterFailure] = useState<string | null>(null);
  const [gapInputs, setGapInputs] = useState<Record<string, string>>({});
  const [selectedGaps, setSelectedGaps] = useState<Set<string>>(new Set());
  const [gapFailure, setGapFailure] = useState<string | null>(null);

  const rows = buildRows(view);
  const unfilledGaps = view.gaps.filter((g) => g.filledAt === null);

  const hasReporter = view.reporterName !== null || view.reporterContact !== null;

  const readReporter = () => {
    setReporterFailure(null);
    onReadReporter?.()
      .then((result) => {
        if (!result.ok) {
          setReporterFailure(
            result.status === 403 ? '没有查看实名权限。' : `查看实名未受理（${result.status}）。`,
          );
          return;
        }
        setReporter({ name: result.reporterName, contact: result.reporterContact });
      })
      .catch(() => setReporterFailure('查看实名读取失败。'));
  };

  const handleInputChange = (key: string, value: string) => {
    setGapInputs((prev) => ({ ...prev, [key]: value }));
  };

  const handleToggleSelect = (key: string) => {
    setSelectedGaps((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSingleFill = (key: string) => {
    const value = gapInputs[key];
    if (!value) return;
    setGapFailure(null);
    onGapFill?.([{ key, value }])
      .then((result) => {
        if (!result.ok) {
          setGapFailure(
            result.status === 403 ? '没有补齐权限。' : `补齐未受理（${result.status}）。`,
          );
          return;
        }
        setGapInputs((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        setSelectedGaps((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      })
      .catch(() => setGapFailure('补齐请求失败。'));
  };

  const handleBatchFill = () => {
    if (selectedGaps.size === 0) return;
    const fills = [...selectedGaps]
      .filter((key) => gapInputs[key])
      .map((key) => ({ key, value: gapInputs[key] }));
    if (fills.length === 0) return;
    setGapFailure(null);
    onGapFill?.(fills)
      .then((result) => {
        if (!result.ok) {
          setGapFailure(
            result.status === 403 ? '没有补齐权限。' : `批量补齐未受理（${result.status}）。`,
          );
          return;
        }
        setGapInputs((prev) => {
          const next = { ...prev };
          for (const fill of fills) delete next[fill.key];
          return next;
        });
        setSelectedGaps(new Set());
      })
      .catch(() => setGapFailure('批量补齐请求失败。'));
  };

  return (
    <div>
      {/* 基本信息区 */}
      <div className="card">
        <div className="card-h">
          基本信息
          <span className="hint">{`线索编号 ${view.code}`}</span>
        </div>
        <div className="filters">
          <span className="tag gray">{`法域：${view.domain}`}</span>
          <span className="tag gray">{`来源：${view.sourceCode}`}</span>
          <span className="tag gray">{`登记日期：${view.registeredAt}`}</span>
          <span className="tag gray">{`接收日期：${view.receivedAt}`}</span>
          <span className="tag gray">{`当前状态：${view.statusLabel}`}</span>
          <span className="tag gray">{`核查状态：${view.verificationStatus}`}</span>
        </div>
        {view.narrative ? (
          <div className="desc">
            <b>叙事摘要：</b>
            {view.narrative}
          </div>
        ) : null}
        {view.tags.length > 0 ? (
          <div className="filters">
            {view.tags.map((tag) => (
              <span key={tag} className="tag">{tag}</span>
            ))}
          </div>
        ) : null}
        {view.initialTypes.length > 0 ? (
          <div className="filters">
            <span className="tag gray">初步涉嫌违法类型：</span>
            {view.initialTypes.map((tc) => (
              <span key={tc} className="tag">{tc}</span>
            ))}
          </div>
        ) : null}
        <div className="filters">
          {view.subjectUnknown ? <span className="tag">当事人不明</span> : null}
          {view.anonymityConfirmed ? <span className="tag gray">已确认匿名</span> : null}
        </div>
      </div>

      {/* 反映人区：匿名线索不展示 */}
      {view.anonymityConfirmed ? (
        <div className="card">
          <div className="card-h">反映人</div>
          <div className="empty">
            <div className="t">已确认匿名</div>
            <div>本线索已确认匿名反映，不展示反映人信息。</div>
          </div>
        </div>
      ) : hasReporter ? (
        <div className="card">
          <div className="card-h">反映人</div>
          <div className="filters">
            {reporter === null ? (
              <>
                {view.reporterName !== null ? (
                  <span className="tag gray">{`反映人：${maskName(view.reporterName)}`}</span>
                ) : null}
                {view.reporterContact !== null ? (
                  <span className="tag gray">{`联系方式：${maskContact(view.reporterContact)}`}</span>
                ) : null}
                {onReadReporter !== undefined ? (
                  <button type="button" className="btn btn-sm" onClick={readReporter}>
                    查看实名
                  </button>
                ) : null}
              </>
            ) : (
              <span className="tag">
                {`实名：${reporter.name ?? '—'}（${reporter.contact ?? '—'}）`}
              </span>
            )}
            {reporterFailure !== null ? <span className="err">{reporterFailure}</span> : null}
          </div>
        </div>
      ) : null}

      {/* 要件清单区 */}
      <RequirementsSection
        rows={rows}
        gapInputs={gapInputs}
        selectedGaps={selectedGaps}
        onInputChange={handleInputChange}
        onToggleSelect={handleToggleSelect}
        onSingleFill={handleSingleFill}
        supervisorReadonly={supervisorReadonly === true}
        busy={busy}
      />

      {/* 一键补齐 */}
      {supervisorReadonly !== true && unfilledGaps.length > 0 && onGapFill !== undefined ? (
        <div className="card">
          <div className="filters">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={busy === true || selectedGaps.size === 0}
              onClick={handleBatchFill}
            >
              一键补齐选中项
            </button>
            <span className="hint">
              {selectedGaps.size === 0
                ? '勾选上方缺件项后可批量补齐'
                : `已选 ${selectedGaps.size} 项`}
            </span>
          </div>
          {gapFailure !== null ? <div className="err">{gapFailure}</div> : null}
        </div>
      ) : null}

      {/* 监督只读说明 */}
      {supervisorReadonly === true ? (
        <div className="help">
          当前角色为监督，无经办或内勤角色，补齐功能不可用。
        </div>
      ) : null}

      {/* 缺件清单 */}
      <GapsSection gaps={view.gaps} unfilledCount={unfilledGaps.length} />

      {/* 系统外移送附加记录（#229）：仅处置为 other 时展示 */}
      {view.status === 'handler_assigned' || view.status === 'filed' || view.status === 'closed' ? (
        <ClueFilingPanel clueId={view.id} clueStatus={view.status} />
      ) : null}
      {view.latestDisposition === 'other' ? (
        <ClueExternalTransferSection
          clueId={view.id}
          mayAttach={supervisorReadonly !== true}
          supervisorReadonly={supervisorReadonly === true}
        />
      ) : null}
    </div>
  );
}