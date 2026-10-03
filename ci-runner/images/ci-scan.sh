#!/usr/bin/env bash
# trivy image. Пароль реестра берётся из окружения, в аргументы не попадает.
# TRIVY_DB_REPOSITORY — зеркало базы уязвимостей, если с GitHub её не скачать.
set -euo pipefail

ref="${1:?ссылка образа image@sha256:...}"
case "$ref" in
  *@sha256:*) ;;
  *) echo "ERROR: сканировать нужно ссылку по digest, получено '$ref'" >&2; exit 1 ;;
esac

export TRIVY_USERNAME="${LT_REGISTRY_USER:-${CI_REGISTRY_USER:-}}"
export TRIVY_PASSWORD="${LT_REGISTRY_PASSWORD:-${CI_REGISTRY_PASSWORD:-}}"
severity="${LT_TRIVY_SEVERITY:-HIGH,CRITICAL}"

exec trivy image --severity "$severity" --exit-code 1 --ignore-unfixed --no-progress "$ref"
