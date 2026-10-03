#!/usr/bin/env bash
# Стадия Pre-check: единственная точка, где прогон признаётся допустимым.
#
# Проверяет контракт RUN_SPEC, политики запуска и наличие артефакта, после чего
# формирует .nt/run.json (для машин) и .nt/run.env (для шелла). Все последующие
# стадии работают только с этими двумя файлами.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ci/lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

require_tools python3

if [ -n "${S3_MANIFEST_URL:-}" ]; then
  require_tools curl
  bash "$SCRIPT_DIR/fetch-s3.sh"
fi

info "контракт v${LT_CONTRACT_VERSION:-1}, источник пайплайна: ${CI_PIPELINE_SOURCE:-local}"

# `|| status=$?` обязателен: при set -e падение python прервало бы скрипт
# до того, как мы успеем перевести код выхода в человеческую формулировку.
status=0
python3 "$SCRIPT_DIR/lib/run_spec.py" "$@" || status=$?

if [ "$status" -eq 0 ]; then
  python3 "$SCRIPT_DIR/lib/child_pipeline.py" || status=$?
fi

if [ "$status" -eq "$LT_EXIT_CONTRACT" ]; then
  warn "прогон отклонён: нарушен контракт или политика запуска. Повтор не поможет — исправьте параметры"
elif [ "$status" -eq "$LT_EXIT_ENVIRONMENT" ]; then
  warn "прогон отклонён: проблема окружения runner'а, а не входных данных"
fi

exit "$status"
