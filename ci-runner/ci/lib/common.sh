#!/usr/bin/env bash
# Общие помощники для CI-скриптов. Подключать через: source "$(dirname "$0")/lib/common.sh"
#
# Намеренно без `set -x`: трассировка печатает всё окружение job, включая
# токены Vault/GitLab/S3, прямо в лог пайплайна.

set -euo pipefail

# Коды совпадают с run_spec.py и читаются подключающими скриптами.
# shellcheck disable=SC2034
LT_EXIT_CONTRACT=2
LT_EXIT_ENVIRONMENT=3

log()  { printf '%s [%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "${1}" "${2}"; }
info() { log INFO "$*"; }
warn() { log WARN "$*" >&2; }

die() {
  local code="${2:-1}"
  log ERROR "$1" >&2
  exit "$code"
}

# Проверка наличия обязательных утилит до начала работы: падать надо на первой
# секунде с понятным текстом, а не на середине прогона.
require_tools() {
  local missing=()
  for tool in "$@"; do
    command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
  done
  if [ ${#missing[@]} -gt 0 ]; then
    die "в образе CI нет утилит: ${missing[*]}. См. раздел предподготовки (образ lt-ci-tools)" \
        "$LT_EXIT_ENVIRONMENT"
  fi
}