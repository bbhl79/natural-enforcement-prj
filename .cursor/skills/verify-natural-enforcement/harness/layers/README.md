# 验证专用假图层

开发环境没有客户图层地址时，自动核查会确定性「查不成」。本目录给验证准备一个本地假服务，协议与 `backend/case/src/clue/verification/layer-service-port.ts` 相同。产品业务代码不改。`infra/runtime.env` 里的图层地址保持为空。

## 协议

`GET /query?layer={图层键}&geometry={Polygon GeoJSON}&srid=4490`

200 的正文是 GeoJSON FeatureCollection。要素要有 `id`、`geometry`、`properties.intersection`、`properties.total_area`、`properties.overlap_area`。

## 场景

登记几何的属性会被产品剥掉。假服务只看面的首点经度：

| 经度带 | 场景 | 适配器读到的事实 |
| --- | --- | --- |
| [113.2, 113.3) | 核查成功 | 七层 `overlapped`，相交比例 1 |
| [113.3, 113.4) | 部分命中 | 前三层 `overlapped` 且相交比例 0.25，后四层 `no_overlap` |
| [113.4, 113.5) | 疑似重复夹具 | 图层事实同成功。查重来自两条相同的面，阈值仍是 60% |
| 其他 | 查过没有 | 七层空要素，`no_overlap` |

部分命中不是新的产品状态。页面三态仍是有相交、无相交、查不成。0.25 是相交面积 250 除以要素面积 1000。

空地址不经过本服务。适配器自己把未配置的层判成 `service-not-configured`。

产品 `infra/docker-compose.yml` 没有把 `RUSTFS_*` 送进 server。登记要写空间文件，缺这些参数时存储客户端打到容器内的 `127.0.0.1:9000`，请求 500。`docker-compose.verify-runtime.yml` 只在验证期间补上这些参数，值来自 `infra/runtime.env` 的开发夹具。验证结束执行 `restore`，server 回到产品 compose。

假服务桶需要对象锁和版本控制。`apply-layer-overlay.sh` 在 `on` 和 `off` 之后检查桶。桶一旦没有对象锁就不能后补，只能删掉重建。

## 叠用与卸下

`apply-layer-overlay.sh on` 把七个 `NE_LAYER_URL_*` 指到 compose 网络里的 `http://verify-layers:8099/query`，并重建 server 与 nginx。

`apply-layer-overlay.sh off` 删掉假服务，按 `infra/docker-compose.yml` 重建 server。地址回到清单里的空值。

`harness/run-auto-verification.sh` 会在退出时执行 off。

协议自检不启动业务栈：

```bash
node --experimental-transform-types --disable-warning=ExperimentalWarning .cursor/skills/verify-natural-enforcement/harness/layers/protocol-self-check.mjs
```
