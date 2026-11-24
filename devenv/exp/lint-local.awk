# 检查 bash 的 `local a=... b="...$a..."`：同一条 local 语句里后一个参数引用前一个参数——
# bash 在赋值之前就展开全部参数，`set -u` 下报 "unbound variable"。本实验已在 lib.sh 与
# run-closed-loop.sh 各踩一次。用法：awk -f lint-local.awk file.sh...（发现即打印并以非零退出）
function ident(w) { return w ~ /^[A-Za-z_][A-Za-z0-9_]*=/ || w ~ /^[A-Za-z_][A-Za-z0-9_]*$/ }
BEGIN { bad = 0 }
{
  line = $0
  if (!match(line, /(^|[;{(])[[:space:]]*(local|declare|typeset)[[:space:]]+/)) next
  rest = substr(line, RSTART + RLENGTH)
  if (match(rest, /;|&&|\|\|/)) rest = substr(rest, 1, RSTART - 1)
  n = split(rest, words, /[[:space:]]+/)
  nn = 0
  for (i = 1; i <= n; i++) {
    w = words[i]
    if (w == "" || substr(w, 1, 1) == "-") continue
    if (!ident(w)) continue
    name = w; rhs = ""
    eq = index(w, "=")
    if (eq) { name = substr(w, 1, eq - 1); rhs = substr(w, eq + 1) }
    for (j = 1; j <= nn; j++) {
      pat = "\\$\\{?" names[j] "([^A-Za-z0-9_]|$)"
      if (rhs ~ pat) {
        printf "%s:%d: local %s references $%s declared earlier in the SAME statement (unbound under set -u)\n", FILENAME, FNR, name, names[j]
        bad = 1
      }
    }
    nn++; names[nn] = name
  }
  for (k in names) delete names[k]
}
END { exit bad }
