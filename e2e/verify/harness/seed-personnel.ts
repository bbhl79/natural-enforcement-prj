// 用途：经管理台接口种入验证用人员，按编码从机构树解析机构，可重复调用。
// 经管理台接口种入验证用人员（不改产品种子）。
// 已存在（409）视为种入完成，因此可以重复调用。

import { loadIdentity } from './load-fixtures.ts';
import type { SessionCache } from './session.ts';

/** 验证人员的登记行：编码、姓名、机构编码、手机号、角色与可选的执法证。 */
export interface PersonSeed {
  readonly code: string;
  readonly name: string;
  readonly orgCode: string;
  readonly mobilePhone: string;
  readonly roles: readonly string[];
  /** 执法证号；与 certExpiresOn 同时给出时登记有效执法证（承办人须具备执法资格）。 */
  readonly certNo?: string;
  readonly certExpiresOn?: string;
}

/** 验证跑次使用的三名内勤：甲区内勤、甲所内勤、甲所主办甲。手机号与身份夹具一致。 */
export const VERIFY_PERSONNEL: readonly PersonSeed[] = [
  { code: 'P-INTAKE-A', name: '甲区内勤', orgCode: 'ORG-DEPT-A', mobilePhone: '13900002001', roles: ['内勤'] },
  { code: 'P-INTAKE-ST', name: '甲所内勤', orgCode: 'ORG-STATION-A', mobilePhone: '13900002003', roles: ['内勤'] },
  {
    code: 'P-HANDLER-ST1',
    name: '甲所主办甲',
    orgCode: 'ORG-STATION-A',
    mobilePhone: '13900002004',
    roles: ['经办'],
    certNo: 'ENF-P-HANDLER-ST1',
    certExpiresOn: '2099-12-31',
  },
];

const INITIAL_PASSWORD = 'Seed-pass-52';

/** 用 admin-hq 身份种入人员。机构按编码从机构树解析。 */
export async function ensurePersonnel(
  sessions: SessionCache,
  baseUrl: string,
  people: readonly PersonSeed[],
): Promise<void> {
  const admin = await loadIdentity('admin-hq');
  const cookie = await sessions.cookieOf(admin);
  const tree = await fetch(`${baseUrl}/api/org-units`, { headers: { cookie } });
  if (tree.status !== 200) throw new Error(`读取机构树失败：HTTP ${tree.status}`);
  const body = (await tree.json()) as { orgUnits?: { id?: string; code?: string }[] };
  for (const person of people) {
    const org = body.orgUnits?.find((unit) => unit.code === person.orgCode);
    if (!org?.id) throw new Error(`机构树缺少 ${person.orgCode}`);
    const created = await fetch(`${baseUrl}/api/admin/personnel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        code: person.code,
        name: person.name,
        orgUnitId: org.id,
        mobilePhone: person.mobilePhone,
        initialPassword: INITIAL_PASSWORD,
        roles: [...person.roles],
        ...(person.certNo ? { certNo: person.certNo, certExpiresOn: person.certExpiresOn } : {}),
      }),
    });
    if (created.status === 200 || created.status === 409) continue;
    const text = await created.text();
    throw new Error(`种入 ${person.code} 失败：HTTP ${created.status} ${text.slice(0, 300)}`);
  }
}
