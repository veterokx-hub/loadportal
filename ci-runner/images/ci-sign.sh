#!/usr/bin/env bash
# Подпись cosign ключом из file-переменной COSIGN_PRIVATE_KEY.
# Transparency log выключен: в контуре нет rekor. Проверка — тем же ключом
# с --insecure-ignore-tlog=true. COSIGN_PASSWORD cosign читает из окружения сам.
set -euo pipefail

ref="${1:?ссылка образа image@sha256:...}"
case "$ref" in
  *@sha256:*) ;;
  *) echo "ERROR: подписывать нужно ссылку по digest, получено '$ref'" >&2; exit 1 ;;
esac

if [ -z "${COSIGN_PRIVATE_KEY:-}" ] || [ ! -f "$COSIGN_PRIVATE_KEY" ]; then
  echo "ERROR: задайте file-переменную COSIGN_PRIVATE_KEY (содержимое ключа, не путь в git)" >&2
  exit 1
fi

if [ "${LT_COSIGN_TLOG:-false}" = "true" ]; then
  cosign sign --key "$COSIGN_PRIVATE_KEY" --yes "$ref"
else
  cosign sign --key "$COSIGN_PRIVATE_KEY" --yes --tlog-upload=false "$ref"
fi

if [ -n "${COSIGN_PUBLIC_KEY:-}" ] && [ -f "$COSIGN_PUBLIC_KEY" ]; then
  cosign verify --key "$COSIGN_PUBLIC_KEY" --insecure-ignore-tlog=true "$ref"
fi

echo "INFO: подписан $ref"
