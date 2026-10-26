// 涉密误传标记面板（管理台机构详情内，只在根机构系统管理员选中本人根机构时出现）。
//
// 纯渲染部分（QuarantineMarkView）供单测直接渲染；提交在 QuarantineMarkPanel。

import { useState } from 'react';

import { useAppDispatch } from '../hooks';
import { markQuarantine } from './quarantineMark';

/** 纯渲染：材料编号、简述与「标记涉密误传」按钮。两项都填才可提交。 */
export function QuarantineMarkView({
  busy,
  failure,
  notice,
  onMark,
}: {
  busy: boolean;
  failure: string | null;
  notice: string | null;
  onMark: (input: { materialId: string; summary: string }) => void;
}) {
  const [materialId, setMaterialId] = useState('');
  const [summary, setSummary] = useState('');
  const ready = materialId.trim() !== '' && summary.trim() !== '';
  return (
    <div className="card" data-role="quarantine-mark">
      <div className="card-h">
        涉密误传标记
        <span className="hint">发现涉密材料误传进业务系统时，由根机构系统管理员标记隔离</span>
      </div>
      {failure ? <div className="banner danger" data-role="failure">{failure}</div> : null}
      {notice ? <div className="banner ok" data-role="notice">{notice}</div> : null}
      <div className="form-row">
        <label htmlFor="quarantine-material">材料编号</label>
        <div>
          <input
            id="quarantine-material"
            className="input"
            value={materialId}
            onChange={(event) => setMaterialId(event.target.value)}
          />
        </div>
      </div>
      <div className="form-row">
        <label htmlFor="quarantine-summary">简述</label>
        <div>
          <input
            id="quarantine-summary"
            className="input"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
          <div className="help">简述必填并留痕。标记后业务读取一律拒绝；原文件仍保留，系统不删除。</div>
        </div>
      </div>
      <button
        type="button"
        className="btn btn-sm btn-danger"
        data-role="quarantine-mark-submit"
        disabled={busy || !ready}
        onClick={() => onMark({ materialId: materialId.trim(), summary: summary.trim() })}
      >
        标记涉密误传
      </button>
    </div>
  );
}

/** 容器：提交标记并给出结果。 */
export default function QuarantineMarkPanel() {
  const dispatch = useAppDispatch();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <QuarantineMarkView
      busy={busy}
      failure={failure}
      notice={notice}
      onMark={(input) => {
        setBusy(true);
        setFailure(null);
        setNotice(null);
        void markQuarantine(dispatch, input).then((result) => {
          setBusy(false);
          if (result.ok) setNotice(`材料 ${input.materialId} 已标记为涉密误传并隔离。`);
          else setFailure(result.message);
        });
      }}
    />
  );
}
