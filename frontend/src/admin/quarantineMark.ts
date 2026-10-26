// 涉密误传标记的数据层（管理台机构详情内）。
//
// 系统管理员把误传进业务系统的涉密材料标为隔离：材料编号＋简述，提交后业务读取一律拒绝，
// 原文件仍保留在存储里，系统不删除。是否有权由服务端决定（只放行目标对象所属根机构的系统管理员），
// 前端只按会话操作码与当前选中机构是否为本人任职的根机构决定显示什么。

import { apiFetch, type ApiDispatch } from '../api';
import type { OrgTreeData, OrgUnit } from './orgTree';

/** 会话里授予系统管理的操作码。 */
export const QUARANTINE_MARK = 'storage.quarantine.mark';

/**
 * 入口可见：会话有标记码，且选中的是本人任职机构，且该机构是根机构（没有上级）。
 * 部门系统管理员的树根有上级，看不到入口；根机构系统管理员在根机构详情里看到。
 */
export function canMarkQuarantine(opcodes: readonly string[], tree: OrgTreeData, unit: OrgUnit): boolean {
  return opcodes.includes(QUARANTINE_MARK) && unit.id === tree.rootId && unit.parentId === null;
}

/** 标记结果。 */
export type QuarantineMarkResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

/** 失败文案：简述必填、材料不存在、已标记、无权限或不属于本根机构。 */
export function quarantineMarkFailureText(status: number, body: unknown): string {
  const value = (typeof body === 'object' && body !== null ? body : {}) as { result?: string; reason?: string };
  if (status === 403) {
    return value.reason === 'scope-denied'
      ? '该材料不属于你任职的根机构，不能标记。'
      : '你没有权限执行这个操作。';
  }
  if (status === 400 && value.reason === 'missing-summary') return '标记涉密误传须填写简述。';
  if (status === 404) return '找不到这个材料编号，请核对后再试。';
  if (status === 409 && value.reason === 'already-quarantined') return '该材料已标记为涉密误传，无须重复标记。';
  return '操作未完成，请重试。';
}

/** 标记涉密误传：调用隔离接口。 */
export async function markQuarantine(
  dispatch: ApiDispatch,
  input: { readonly materialId: string; readonly summary: string },
): Promise<QuarantineMarkResult> {
  const response = await apiFetch(
    dispatch,
    `/api/storage/materials/${encodeURIComponent(input.materialId)}/quarantine`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ summary: input.summary }),
    },
  );
  if (response.ok) return { ok: true };
  const body = (await response.json().catch(() => null)) as unknown;
  return { ok: false, message: quarantineMarkFailureText(response.status, body) };
}
