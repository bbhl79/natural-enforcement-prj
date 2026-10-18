// 根机构守卫（ADR 0014，#105「守卫二」，#129）。
// 系统始终保留至少一名「当前任职在根机构、未停用、持有未停用系统管理角色」的人员。
// 本票受约束的动作是摘除系统管理角色与调岗出根机构；停用由 #130 接入同一判断。
// 守卫在事务级咨询锁内判断：两名系统管理并发互相摘除或调出时只有一方成功。

import { BOOTSTRAP_ADMIN_ROLE } from './bootstrap.ts';

/** 守卫看住的角色。取值同参照种子写入的「系统管理」（GLOSSARY「角色」、ADR 0009）。 */
export const ROOT_GUARD_ROLE = BOOTSTRAP_ADMIN_ROLE;

/**
 * 违反守卫时的失败原因。同一个词写进留痕的失败原因和 409 返回体的 reason
 *（#105 错误码表「409 可读原因」：原因码用连字符小写，留痕的失败原因取同一个词）。
 */
export const ROOT_GUARD_REASON = 'root-admin-required';

/** 违反守卫时给人看的一句原因（#105：409 返回「码＋一句原因」，用词遵守 GLOSSARY）。 */
export const ROOT_GUARD_MESSAGE = '根机构上只剩这一名系统管理人员。系统必须始终保留一名在根机构任职、未停用的系统管理人员，请先给根机构补上另一名系统管理人员。';
