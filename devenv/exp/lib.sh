#!/usr/bin/env bash
# 实验工具（#54）：deps 层缓存复用实验公共库。
# 证据默认落在 $HOME/ne-deps-evidence（仓库外，避免被 git reset 清掉）。
set -Eeuo pipefail

EXP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$EXP_DIR/../.." && pwd)"
EVIDENCE_DIR="${EVIDENCE_DIR:-$HOME/ne-deps-evidence}"
STORE_ID="${STORE_ID:-ne-pnpm-exp-20261124-v11}"
mkdir -p "$EVIDENCE_DIR"

now_ms() { date +%s%3N; }

record() { # record <name> <startMs> <endMs> <rc> [extraJsonFragment]
  local name="$1" start="$2" end="$3" rc="$4" extra="${5:-}"
  printf '{"name":"%s","startMs":%s,"endMs":%s,"durationMs":%s,"exitCode":%s%s}\n' \
    "$name" "$start" "$end" "$((end - start))" "$rc" "$extra" >>"$EVIDENCE_DIR/results.jsonl"
}

run_logged() { # run_logged <name> <logfile> <cmd...>
  local name="$1" log="$2"
  shift 2
  local t0 t1 rc
  t0="$(now_ms)"
  set +e
  "$@" >"$log" 2>&1
  rc=$?
  set -e
  t1="$(now_ms)"
  record "$name" "$t0" "$t1" "$rc"
  printf '[exp] %-34s exit=%s duration=%sms log=%s\n' "$name" "$rc" "$((t1 - t0))" "$log" >&2
  return "$rc"
}

evidence_of() { # evidence_of <log> -> 最后一条 EVIDENCE 的 JSON（无则空）
  local log="$1"
  grep -o 'EVIDENCE {.*}' "$log" 2>/dev/null | tail -1 | sed 's/^EVIDENCE //' || true
}

save_evidence() { # save_evidence <name> <log>：把 EVIDENCE 行抽成同名 .evidence.json
  local name="$1" log="$2" ev
  ev="$(evidence_of "$log")"
  if [[ -n "$ev" ]]; then
    printf '%s\n' "$ev" >"$EVIDENCE_DIR/$name.evidence.json"
  else
    printf '{"note":"no EVIDENCE line (install layer likely cache-hit or failed)"}\n' \
      >"$EVIDENCE_DIR/$name.evidence.json"
  fi
}

git_reset() {
  git -C "$REPO_ROOT" reset --hard HEAD >/dev/null
  git -C "$REPO_ROOT" clean -fd >/dev/null
}

network_probe() { # 记录实际网络（只报告不控制）；单流 tarball + registry 元数据
  local out="$1"
  {
    echo "epoch=$(date +%s)"
    echo "date=$(date -Is)"
    echo "--- tarball https://registry.npmjs.org/typescript/-/typescript-6.0.3.tgz ---"
    curl -sL -o /dev/null -w 'bytes=%{size_download} seconds=%{time_total} speed_Bps=%{speed_download}\n' \
      --max-time 180 https://registry.npmjs.org/typescript/-/typescript-6.0.3.tgz || echo 'tarball probe failed'
    echo "--- metadata https://registry.npmjs.org/is-odd ---"
    curl -sL -o /dev/null -w 'bytes=%{size_download} seconds=%{time_total} speed_Bps=%{speed_download}\n' \
      --max-time 120 https://registry.npmjs.org/is-odd || echo 'metadata probe failed'
  } >"$out" 2>&1
}

record_env() { # record_env <label>
  local label="$1"
  local out="$EVIDENCE_DIR/env-$label.txt"
  local net="$EVIDENCE_DIR/.network-$label.txt"
  network_probe "$net"
  {
    echo "=== label: $label ==="
    cat "$net"
    echo
    echo "=== platform ==="
    uname -a
    echo "kernel=$(uname -r) arch=$(uname -m)"
    echo "DOCKER_HOST=${DOCKER_HOST:-<unset>}"
    docker version 2>&1 | sed -n '1,40p'
    echo
    echo "=== images (related) ==="
    docker images --format '{{.Repository}}:{{.Tag}} {{.ID}} {{.Size}}' 2>&1 | grep -E 'natural-enforcement|node|alpine' || true
    echo
    echo "=== system df ==="
    docker system df 2>&1
    echo
    echo "=== git ==="
    git -C "$REPO_ROOT" rev-parse HEAD
    git -C "$REPO_ROOT" status --short
  } >"$out" 2>&1
  rm -f "$net"
  printf '[exp] environment recorded: %s\n' "$out" >&2
}

docker_build_deps() { # docker_build_deps <tag> [额外参数...]
  local tag="$1"
  shift
  docker build "$@" --target deps -t "$tag" -f "$REPO_ROOT/devenv/workspace.Dockerfile" "$REPO_ROOT"
}

dockerfile_sha() { sha256sum "$REPO_ROOT/devenv/workspace.Dockerfile" | cut -d' ' -f1; }
lockfile_sha() { sha256sum "$REPO_ROOT/pnpm-lock.yaml" | cut -d' ' -f1; }

save_state() { # save_state <label>
  local label="$1"
  local out="$EVIDENCE_DIR/state-$label.txt"
  {
    echo "dockerfile_sha=$(dockerfile_sha)"
    echo "lockfile_sha=$(lockfile_sha)"
    echo "workspace_dockerfile_diff:"
    git -C "$REPO_ROOT" diff -- devenv/workspace.Dockerfile
    echo "lockfile_diff_stat:"
    git -C "$REPO_ROOT" diff --stat -- pnpm-lock.yaml
    echo "workspace_packages:"
    find "$REPO_ROOT/packages" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort
  } >"$out" 2>&1
}

regen_lockfile_direct() { # 实验用：复刻 devenv regen_lockfile（lockgen 靶 → docker cp 导出）
  local log="$EVIDENCE_DIR/lockgen-direct.log" t0 t1 rc
  t0="$(now_ms)"
  set +e
  {
    docker ps -a --filter ancestor=ne-lockgen:tmp -q | xargs -r docker rm -f >/dev/null 2>&1 || true
    docker rmi -f ne-lockgen:tmp >/dev/null 2>&1 || true
    docker build --target lockgen -t ne-lockgen:tmp \
      -f "$REPO_ROOT/devenv/workspace.Dockerfile" "$REPO_ROOT"
    local cid
    cid="$(docker create ne-lockgen:tmp)"
    docker cp "$cid":/workspace/pnpm-lock.yaml "$REPO_ROOT/pnpm-lock.yaml"
    docker rm "$cid" >/dev/null
    docker rmi ne-lockgen:tmp >/dev/null
  } >"$log" 2>&1
  rc=$?
  set -e
  t1="$(now_ms)"
  record lockgen-direct "$t0" "$t1" "$rc"
  printf '[exp] %-34s exit=%s duration=%sms log=%s\n' lockgen-direct "$rc" "$((t1 - t0))" "$log" >&2
  return "$rc"
}