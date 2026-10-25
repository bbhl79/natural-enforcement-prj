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
      default:
        return '提交未通过，请检查后再试。';
    }
  }
  if (value.result === 'concurrent-change') return '线索状态已被他人变更，请刷新后重试。';
  if (value.result === 'invalid-state') {
    if (value.reason === 'designated-lock') return '该线索已指定管辖：仅指定者或其上级可再调整。';
    if (value.reason === 'org-unit-deactivated') return '目标机构已停用，不能接收线索。';
    return '当前状态不能执行该操作。';
  }
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
      onDecide={(decision, acknowledged) =>
        void run(() => submitDecide(dispatch, clueId, { decision, acknowledged, expectedStatus: view.status }))
      }
      onAssignOrg={(input) =>
        void run(() =>
          submitAssignOrg(dispatch, clueId, {
            ...input,
            expectedStatus: view.status,
          }),
        )
      }
      onAssignPeople={(input) =>
        void run(() =>
          submitAssignPeople(dispatch, clueId, {
            ...input,
            expectedStatus: view.status,
          }),
        )
      }
    />
  );
}
