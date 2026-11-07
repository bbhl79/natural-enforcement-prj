'use strict';

/** 样本年龄。4 年是本夹具的断言，不是产品回溯上限。 */

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

function ageYears(instantMs, nowMs) {
  return (nowMs - instantMs) / MS_PER_YEAR;
}

function isAncient(instantMs, nowMs, minYears) {
  return Number.isFinite(instantMs) && ageYears(instantMs, nowMs) >= minYears;
}

/** 查重接口把登记时间收成 UTC 日或月。 */
function parseRegisteredAt(text) {
  if (typeof text !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return Date.parse(`${text}T00:00:00.000Z`);
  if (/^\d{4}-\d{2}$/.test(text)) return Date.parse(`${text}-01T00:00:00.000Z`);
  return null;
}

module.exports = { ageYears, isAncient, parseRegisteredAt };
