#!/usr/bin/env bash
# Скачивает скрипт прогона по presigned-манифесту SeaweedFS.
# URL в лог не пишутся: в них подпись.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ci/lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

[ -n "${S3_MANIFEST_URL:-}" ] || die "S3_MANIFEST_URL пуст" "$LT_EXIT_CONTRACT"

manifest="$(mktemp)"
trap 'rm -f "$manifest"' EXIT

curl -fsSL --retry 2 --max-time 60 "$S3_MANIFEST_URL" -o "$manifest" \
  || die "не удалось скачать манифест скрипта из S3" "$LT_EXIT_ENVIRONMENT"

count=0
while IFS=$'\t' read -r key url || [ -n "${key:-}" ]; do
  [ -z "${key:-}" ] && continue
  case "$key" in
    /*|..|../*|*/../*|*/..) die "недопустимый ключ в манифесте S3" "$LT_EXIT_CONTRACT" ;;
  esac
  [ -n "${url:-}" ] || die "в манифесте S3 нет URL для $key" "$LT_EXIT_CONTRACT"
  mkdir -p -- "$(dirname "$key")"
  curl -fsSL --retry 2 --max-time 120 "$url" -o "$key" \
    || die "не удалось скачать $key из S3" "$LT_EXIT_ENVIRONMENT"
  count=$((count + 1))
done < "$manifest"

[ "$count" -gt 0 ] || die "манифест S3 пуст" "$LT_EXIT_CONTRACT"
info "из S3 скачано файлов: ${count}"
