/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');

/** 填满本旅程每个渲染要件。新增字段没有夹具值即失败，不用自动猜值掩盖缺口。 */
async function registerFull({ page, baseUrl, fixture, record, shot, suffix }) {
  await page.goto(`${baseUrl}/workbench`, { waitUntil: 'domcontentloaded' });
  await page.locator('a[href="/workbench/register"]').first().click();
  await page.locator('#clue-source').waitFor();
  assert.equal(await page.locator('[data-role="register-gate"]').count(), 0);
  assert.equal(await page.locator('#clue-source').inputValue(), '');
  assert.equal(await page.locator('#clue-domain').inputValue(), '');
  for (const group of ['基本信息', '来源补充', '违法类型', '材料']) {
    assert.equal(await page.locator(`[data-group="${group}"]`).isVisible(), true);
  }
  await page.locator('#clue-source').selectOption(fixture.sourceCode);
  await page.waitForURL((url) => url.searchParams.get('sourceCode') === fixture.sourceCode);
  await page.locator('[data-key="clue.finder"] input').waitFor();
  await page.locator('#clue-domain').selectOption(fixture.domain);
  await page.waitForURL((url) => url.searchParams.get('domain') === fixture.domain);
  for (const type of fixture.types) await page.locator(`[data-type="${type}"]`).check();
  const typeKey = Object.keys(fixture.values).find((key) => key.startsWith('type.'));
  await page.locator(`[data-key="${typeKey}"] input`).waitFor();
  const fields = { sourceCode: fixture.sourceCode, domain: fixture.domain, types: fixture.types };
  const form = page.locator('form').filter({ has: page.locator('#clue-source') });
  const rows = form.locator('[data-key]');
  for (let index = 0; index < await rows.count(); index += 1) {
    const row = rows.nth(index);
    const key = await row.getAttribute('data-key');
    if (key === 'clue.initial_types') continue;
    const control = row.locator('input, textarea, select').first();
    if (key === 'clue.location') {
      await control.setInputFiles({ name: `vf-${suffix}.geojson`, mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(fixture.spatialSource)) });
      fields[key] = fixture.spatialSource;
    } else if (key === 'clue.materials') {
      // 合成1像素PNG；材料通过真实文件控件随multipart上传。
      await control.setInputFiles({ name: 'vf-evidence.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') });
      fields[key] = ['vf-evidence.png'];
    } else {
      assert.ok(Object.hasOwn(fixture.values, key), `未覆盖渲染要件：${key}`);
      const value = fixture.values[key].replaceAll('{runKey}', fixture.runKey).replaceAll('{suffix}', suffix) + (key === 'clue.narrative' ? ` [${suffix}]` : '');
      if (await control.evaluate((node) => node.tagName === 'SELECT')) await control.selectOption(value);
      else await control.fill(value);
      assert.equal(await control.inputValue(), value);
      fields[key] = value;
    }
  }
  assert.deepEqual(Object.keys(fields).filter((key) => key.startsWith('clue.') || key.startsWith('type.')).sort(), [...Object.keys(fixture.values), 'clue.location', 'clue.materials'].sort(), '夹具字段必须全部渲染并填写');
  await page.locator('#clue-subject-unknown').selectOption('否');
  await page.locator('#clue-anonymity-confirmed').selectOption('否');
  fields.subjectUnknown = false;
  fields.anonymityConfirmed = false;
  // 每个可编辑控件均有明确取值（多选类型只要求已选目标类型）。
  const empty = await form.locator('input:not([type="checkbox"]), textarea, select').evaluateAll((nodes) => nodes.filter((node) => !node.disabled && !node.value).map((node) => node.id));
  assert.deepEqual(empty, [], '全量表单不允许空控件');
  record(`register-${suffix}-fields`, true, { allRenderedFields: true }, fields, [await shot(`register-${suffix}-filled`)]);
  const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/clues' && response.request().method() === 'POST');
  await page.locator('button[type="submit"].btn-primary').click();
  const response = await responsePromise;
  const body = await response.json();
  record(`register-${suffix}-submit`, response.status() === 201 && body.result === 'registered' && Boolean(body.id) && body.gaps?.length === 0,
    { http: 201, result: 'registered', gaps: [] }, { http: response.status(), body }, [await shot(`register-${suffix}-submitted`)]);
  assert.equal(response.status(), 201, JSON.stringify(body));
  assert.equal(body.result, 'registered');
  assert.ok(body.id);
  assert.deepEqual(body.gaps, []);
  await page.locator('[data-role="registered"]').waitFor();
  const persisted = await page.request.get(`${baseUrl}/api/clues/${body.id}/dispatch`);
  assert.equal(persisted.status(), 200);
  const view = await persisted.json();
  assert.equal(view.clueId, body.id);
  assert.equal(view.status, body.status);
  const detailResponse = await page.request.get(`${baseUrl}/api/clues/${body.id}/detail`);
  assert.equal(detailResponse.status(), 200);
  const detail = await detailResponse.json();
  assert.equal(detail.narrative, fields['clue.narrative']);
  assert.equal(detail.domain, fixture.domain);
  assert.equal(detail.sourceCode, fixture.sourceCode);
  assert.equal(detail.receivedAt.slice(0, 10), fixture.values['clue.received_at']);
  assert.equal(detail.subjectUnknown, false);
  assert.equal(detail.anonymityConfirmed, false);
  assert.deepEqual(detail.tags.slice().sort(), fields['clue.tags'].split('，').sort());
  assert.deepEqual(detail.initialTypes, fixture.types);
  const persistedValues = Object.fromEntries(detail.values.map(({ key, value }) => [key, value]));
  for (const [key, value] of Object.entries(fields)) {
    if (key.startsWith('type.') || ['clue.finder', 'clue.patrol_no', 'clue.campaign_no', 'clue.satellite_batch', 'clue.satellite_plot'].includes(key)) assert.equal(persistedValues[key], value, `${key}持久化不符`);
  }
  record(`register-${suffix}-persisted`, true, { clueId: body.id, status: body.status }, { clueId: view.clueId, status: view.status, mayDecide: view.mayDecide, mayAssignOrg: view.mayAssignOrg, hitGroups: view.hitGroups, detail: { verificationStatus: detail.verificationStatus, narrative: detail.narrative, tags: detail.tags, initialTypes: detail.initialTypes, values: detail.values } });
  return body;
}
module.exports = { registerFull };
