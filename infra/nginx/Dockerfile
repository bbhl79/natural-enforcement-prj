# 宿主 nginx 本地镜像（dev build 构建）：钉定官方 nginx + 入库 default.conf。
# 经 COPY 灌配置，禁止再 bind WSL home 下的 default.conf（Podman machine 下
# WSL home bind 不可见，daemon 会造同名空目录并报 Not a directory）。
# 基础镜像唯一依据 infra/VERSIONS.md；compose 只按 image 引用 + pull_policy never。
FROM nginx:1.29.8@sha256:1881968aff6f7cdcc4b888c00a11f4ce241ad7ec957e0cb4a9e19e93a3ff87ea
COPY default.conf /etc/nginx/conf.d/default.conf
