# 由 ./dev 在仓库根 source。不要直接当入口调用。
GZGT_PROFILE=${GZGT_PROFILE:-dev}

case "$GZGT_PROFILE" in
  dev | integration) ;;
  *)
    echo "./dev: 未知档: $GZGT_PROFILE（dev 或 integration）" >&2
    exit 2
    ;;
esac

compose() {
  local -a args=()
  if [[ -f .env ]]; then
    args+=(--env-file .env)
  fi
  docker compose "${args[@]}" \
    -p "gzgt-${GZGT_PROFILE}" \
    -f infras/compose.yaml \
    -f "infras/compose.${GZGT_PROFILE}.yaml" \
    "$@"
}
