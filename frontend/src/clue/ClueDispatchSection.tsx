// 分派办理容器（工作台③分派决定；#214）。
//
// 取分派视图与机构清单，提交分派决定、派机构、派主办／协办；
// 每次成功提交后重新取视图，状态与步骤随之推进。

import { useCallback, useEffect, useState } from 'react';

import { apiFetch } from '../api';
import { useAppDispatch } from '../hooks';
import { ErrorCard } from '../shell/StatusPages';
import { ClueDispatchBody, type OrgOption } from './ClueDispatchPanel';
import {
  loadDispatchView,
  submitAssignOrg,
  submitAssignPeople,
  submitDecide,
  submitTransfer,
  submitDesignateReject,
  submitDesignateRequest,
  type DispatchView,
} from './dispatch';

/** 机构清单（/api/org-units，内勤选承办机构用）。 */
async function loadOrgOptions(dispatch: Parameters<typeof loadDispatchView>[0]): Promise<OrgOption[]> {
  const response = await apiFetch(dispatch, '/api/org-units');
  if (!response.ok) return [];
  const body = (await response.json()) as {
    readonly orgUnits?: readonly {
      readonly id: string;
      readonly name: string;
      readonly deactivatedAt?: string | null;
    }[];
  };
  return (body.orgUnits ?? [])
    .filter((org) => !org.deactivatedAt)
    .map((org) => ({ orgUnitId: org.id, name: org.name }));
}

/** 失败结果的界面文案。 */
export function dispatchFailureText(body: unknown): string {
  if (typeof body !== 'object' || body === null) return '操作未完成，请重试。';
  const value = body as { readonly result?: string; readonly reason?: string; readonly rules?: readonly string[] };
  if (value.result === 'non-compliant') {
    switch (value.rules?.[0] ?? '') {
      case 'ack-required':
        return '存在未结案的疑似重复命中：请先点「已知晓」再派。';
      case 'complaint-must-dispatch':
        return '群众举报线索只能派、不能选不派。';
      case 'missing-reassign-reason':
        return '重新分派须填写理由。';
      case 'handler-main-required':
        return '请指定主办承办人。';
      case 'assignee-not-qualified':
        return '承办人已停用或不属于承办机构。';
      case 'missing-disposition-fields':
        return '移送机关、文书编号与原因必填。';
      case 'invalid-letter-date':
        return '发函日期须为真实日历日（YYYY-MM-DD）。';
      case 'attachment-count-exceeded':
        return '附件不得超过 20 件。';
      case 'attachment-size-exceeded':
      case 'attachment-total-size-exceeded':
        return '附件大小超限：单件不超过 20MB，合计不超过 100MB。';
      case 'attachment-empty':
      case 'attachment-type-not-allowed':
      case 'attachment-content-mismatch':
        return '附件不合规：只收图片、PDF 与 Office 文档，真实内容须与扩展名一致。';
      case 'missing-designate-reason':
        return '报请指定管辖须填写理由。';
      case 'missing-reject-reason':
        return '驳回报请须填写理由。';
      case 'missing-conflict-resolution':
        return '该线索涉及主体冲突待定项，请选择办理方向。';
      case 'missing-conflict-basis':
        return '该线索涉及主体冲突待定项，请填写依据。';
      default:
        return '提交未通过，请检查后再试。';
    }
  }
  if (value.result === 'concurrent-change') return '线索状态已被他人变更，请刷新后重试。';
  if (value.result === 'invalid-state') {
    if (value.reason === 'designation-pending') return '该线索正在报请指定管辖：报请期间不能分派、重新分派或移送。';
    if (value.reason === 'designated-lock') return '该线索已指定管辖：仅指定者或其上级可再调整。';
    if (value.reason === 'org-unit-deactivated') return '目标机构已停用，不能接收线索。';
    if (value.reason === 'designation-pending') return '该线索已报请指定管辖：受理期间不能移送。';
    return '当前状态不能执行该操作。';
  }
  if (value.reason === 'permission-denied') return '当前账号无权办理该操作。';
  return '操作未完成，请重试。';
}

/** 分派办理（工作台③）。 */
export default function ClueDispatchSection({ clueId }: { readonly clueId: string }) {
  const dispatch = useAppDispatch();
  const [view, setView] = useState<DispatchView | null>(null);
  const [orgOptions, setOrgOptions] = useState<readonly OrgOption[]>([]);
  const [error, setError] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setView(await loadDispatchView(dispatch, clueId));
      setError(false);
    } catch {
      setError(true);
    }
  }, [dispatch, clueId]);

  useEffect(() => {
    void reload();
    void loadOrgOptions(dispatch).then(setOrgOptions);
  }, [reload, dispatch]);

  if (error) return <ErrorCard what="分派办理" onRetry={() => void reload()} />;
  if (!view) return <div className="card" aria-busy="true">载入中…</div>;

  const run = async (action: () => Promise<{ ok: boolean; body?: unknown }>) => {
    setBusy(true);
    setFailure(null);
    const result = await action();
    setBusy(false);
    if (result.ok) {
      await reload();
      return;
    }
    setFailure(dispatchFailureText(result.body));
  };

  return (
    <ClueDispatchBody
      view={view}
      orgOptions={orgOptions}
      busy={busy}
      failure={failure}
      onDecide={(decision, acknowledged, conflictResolution, conflictBasis) =>
        void run(() =>
          submitDecide(dispatch, clueId, {
            decision,
            acknowledged,
            expectedStatus: view.status,
            conflictResolution,
            conflictBasis,
          }),
        )
      }
      onAssignOrg={(input) =>
        void run(() =>
          submitAssignOrg(dispatch, clueId, {
            ...input,
            expectedStatus: view.status,
          }),
        )
      }
      onDesignateRequest={(input) =>
        void run(() => submitDesignateRequest(dispatch, clueId, input))
      }
      onDesignateReject={(reason) =>
        void run(() => submitDesignateReject(dispatch, clueId, { reason }))
      }
      onAssignPeople={(input) =>
        void run(() =>
          submitAssignPeople(dispatch, clueId, {
            ...input,
            expectedStatus: view.status,
          }),
        )
      }
      onTransfer={(input) =>
        void run(() =>
          submitTransfer(dispatch, clueId, {
            ...input,
            expectedStatus: view.status,
          }),
        )
      }
    />
  );
}
