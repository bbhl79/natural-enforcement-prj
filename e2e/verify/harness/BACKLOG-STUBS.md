# harness 缺口

本文件对照最小补齐清单。
本文件不新增 scenario。
本文件不把 `latent` 改为 `runnable`。
本文件不改产品断言。
本文件不发明产品回溯上限。
权威段文由主管补引用后再另票实现。

## P1 超长期终态历史

无回溯上限样本已可跑。
入口是 `harness/run-hist-dup-no-lookback.sh`。
该入口在 `./dev up` 之后播种一条 `transferred_out` peer。
该 peer 的 `disposition.recorded_at` 是 `2019-01-01T00:00:00.000Z`。
该 peer 的 `registered_at` 是同一时刻。
探测再登记一块重叠面。
探测读取该线索的 duplicates。
`historicalGroups` 含该 peer 且处置年龄不少于 4 年时，`anyAncientPeerInHist` 为 true。
同一条件下 `noLookbackVerified` 为 true。
4 年是本样本的断言。
4 年不是产品回溯上限。
播种只插入。
播种不改写已有行的时间戳。
历史只读仍未覆盖。
不阻断仍未覆盖。
无提醒仍未覆盖。
无确认仍未覆盖。
历史展示的权限字段仍未写死。
`vf-sc-latent-close` 保持 latent。

## P2 测绘登记后续主路径

登记成功不等于后续主路径完成。
权威缺口是测绘后续核查结果枚举、材料字段、立案衔接。
本 PR 不补该串联。

## P3 合法了结

线索了结与案件定型尚未由主管钉死。
权威缺口是审批链、合法终态、提醒与下一待办口径。
`latent` 保持 `latent`。
本 PR 不补点写 driver。
