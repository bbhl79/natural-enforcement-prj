# shellcheck shell=bash
# 运行参数清单 infra/runtime.env 的读取函数（ADR 0008、#80）。
# dev、tools/structural-test.sh、tools/ci-inject-env.sh 共用本文件，只 source，不直接执行。
# 本文件只解析清单，不 source 清单：清单里的值不当 shell 代码执行。

# 调用方须先设好 RUNTIME_ENV_FILE；未设时按本文件位置推出仓库根。
: "${RUNTIME_ENV_FILE:=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/infra/runtime.env}"

# 输出清单表，每行一项，制表符分隔：名字、类别、必填性、值（derived 项值为空）。
# 清单格式错误时向 stderr 说明行号并返回 1。
runtime_env_table() {
  awk '
    BEGIN { OFS = "\t"; bad = 0; pending = "" }
    /^[[:space:]]*$/ { next }
    /^# @/ {
      n = split(substr($0, 4), f, /[[:space:]]+/)
      if (f[1] !~ /^(param|secret|path|derived)$/ || f[2] !~ /^(required|optional)$/) {
        printf "infra/runtime.env:%d 注解格式不对：%s\n", NR, $0 > "/dev/stderr"; bad = 1; next
      }
      if (f[1] == "derived") {
        if (f[3] !~ /^[A-Z][A-Z0-9_]*$/) {
          printf "infra/runtime.env:%d derived 注解缺名字：%s\n", NR, $0 > "/dev/stderr"; bad = 1; next
        }
        print f[3], "derived", f[2], ""
        next
      }
      pending = f[1] OFS f[2]
      next
    }
    /^#/ { next }
    /^[A-Z][A-Z0-9_]*=/ {
      eq = index($0, "=")
      name = substr($0, 1, eq - 1)
      if (pending == "") {
        printf "infra/runtime.env:%d 变量 %s 上一行缺注解\n", NR, name > "/dev/stderr"; bad = 1; next
      }
      print name, pending, substr($0, eq + 1)
      pending = ""
      next
    }
    { printf "infra/runtime.env:%d 无法识别的行：%s\n", NR, $0 > "/dev/stderr"; bad = 1 }
    END { exit bad }
  ' "$RUNTIME_ENV_FILE"
}

# 清单登记的全部名字（含 derived），一行一个。
runtime_env_names() {
  runtime_env_table | cut -f1
}

# 某个名字在清单里的值。名字不在清单或为 derived 时输出空串并返回 1。
runtime_env_value() { # $1 = 名字
  local name class req value
  while IFS=$'\t' read -r name class req value; do
    if [ "$name" = "$1" ] && [ "$class" != derived ]; then
      printf '%s' "$value"
      return 0
    fi
  done < <(runtime_env_table)
  return 1
}

# 把清单里带值的项导出到当前 shell。环境里已有非空同名变量时保留环境值。
# 结果：RUNTIME_ENV_INJECTED 记下来自环境的名字（空格分隔，首尾各一个空格）。
runtime_env_load() {
  local table name class req value
  table="$(runtime_env_table)" || return 1
  RUNTIME_ENV_INJECTED=" "
  while IFS=$'\t' read -r name class req value; do
    [ "$class" = derived ] && continue
    if [ -n "${!name:-}" ]; then
      RUNTIME_ENV_INJECTED="$RUNTIME_ENV_INJECTED$name "
    else
      export "$name=$value"
    fi
  done <<< "$table"
}
