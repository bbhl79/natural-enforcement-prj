# 全量登记与点击写判据

1. 登录身份为总队内勤 `intake-hq`。登记入口一进入即有四个完整分区。
2. 两次UI登记填写input.json中的每个要件。两次均上传GeoJSON与PNG，并填写标签。
3. 保存真实发送 `POST /api/clues`。两次均为201且gaps为空。回读id与状态一致。
4. 第二条正式命中本轮第一条矿产面。第二条主状态为 `pending_decision`。
5. step2观察实际核查状态。土地和矿产都跑自动核查；本机缺图层会failed，不宣称自动核查成功。
6. step3实点 `decide-dispatch`。响应为200且状态为 `in_pool`。
7. 同身份回读 `mayAssignOrg=true`。选择第一执法支队并实点 `assign-org`。
8. 响应为200，回读为 `org_assigned`，assignment.orgUnitId等于选中的机构。

控件缺失、禁用、跳过、HTTP错误、状态不符均判红。
派承办人不在本旅程范围。

每条使用唯一合成标签。产品同名标签复用FK错误不在本票修复范围。
