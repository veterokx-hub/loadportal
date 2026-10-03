#!/bin/sh
# Установка пакетов ОС поверх корпоративной базы без знания её дистрибутива.
# Использование: install-os-packages.sh <пакет>...
set -eu

if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y --no-install-recommends "$@"
  rm -rf /var/lib/apt/lists/*
elif command -v microdnf >/dev/null 2>&1; then
  microdnf install -y --nodocs --setopt=install_weak_deps=0 "$@"
  microdnf clean all
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y --nodocs --setopt=install_weak_deps=False "$@"
  dnf clean all
else
  echo "ERROR: базовый образ без apt-get/microdnf/dnf; musl-образы не поддерживаются (JRE и k6 требуют glibc)" >&2
  exit 1
fi
