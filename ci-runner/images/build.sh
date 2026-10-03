#!/usr/bin/env bash
# Локальная сборка образов контура НТ в порядке зависимостей.
# Использование: images/build.sh [--push]
# settings.xml с зеркалом Nexus берётся из $MAVEN_SETTINGS, если задан.
# В кластере то же самое делает images/gitlab-ci.yml (kaniko, trivy, cosign).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
# shellcheck source=/dev/null
source versions.env

settings_backup=""
restore_maven_settings() {
  if [ -n "$settings_backup" ] && [ -f "$settings_backup" ]; then
    cp "$settings_backup" lt-gatling/maven-settings.xml
    rm -f "$settings_backup"
  fi
}
trap restore_maven_settings EXIT

# Заглушка в git без зеркала. Настоящий файл подставляется только на время сборки
# и в финальный образ не входит (стадия warm).
if [ -n "${MAVEN_SETTINGS:-}" ]; then
  settings_backup="$(mktemp)"
  cp lt-gatling/maven-settings.xml "$settings_backup"
  cp "$MAVEN_SETTINGS" lt-gatling/maven-settings.xml
fi

if grep -q REPLACE_ME versions.env lt-jmeter/jmeter-plugins.lock; then
  echo "ERROR: в versions.env или jmeter-plugins.lock остались REPLACE_ME — digest и суммы обязательны" >&2
  exit 1
fi

# SBOM и provenance-аттестации живут только в registry: локальный --load их не хранит.
output=(--load)
if [ "${1:-}" = "--push" ]; then output=(--push --provenance=mode=max --sbom=true); fi

base="$REGISTRY/lt-base:r$REVISION"
tag_jmeter="$REGISTRY/lt-jmeter:$JMETER_VERSION-r$REVISION"
tag_k6="$REGISTRY/lt-k6:$(echo "$K6_IMAGE" | sed -n 's|.*:\([^@]*\)@.*|\1|p')-r$REVISION"
tag_gatling="$REGISTRY/lt-gatling:$GATLING_VERSION-jdk17-r$REVISION"
tag_tools="$REGISTRY/lt-ci-tools:r$REVISION"

build() {
  local tag="$1" dir="$2"
  shift 2
  docker buildx build --platform "${PLATFORM:-linux/amd64}" "${output[@]}" --tag "$tag" "$@" "$dir"
}

build "$base" lt-base \
  --build-arg BASE_IMAGE="$BASE_IMAGE" --build-arg TINI_URL="$TINI_URL" --build-arg TINI_SHA256="$TINI_SHA256"

build "$tag_jmeter" lt-jmeter \
  --build-arg LT_BASE_IMAGE="$base" --build-arg JRE_IMAGE="$JRE21_IMAGE" \
  --build-arg JMETER_VERSION="$JMETER_VERSION" --build-arg JMETER_URL="$JMETER_URL" \
  --build-arg JMETER_SHA512="$JMETER_SHA512" --build-arg PIP_INDEX_URL="$PIP_INDEX_URL"

build "$tag_k6" lt-k6 --build-arg LT_BASE_IMAGE="$base" --build-arg K6_IMAGE="$K6_IMAGE"

build "$tag_gatling" lt-gatling \
  --build-arg LT_BASE_IMAGE="$base" --build-arg JDK_IMAGE="$JDK17_IMAGE" --build-arg MAVEN_IMAGE="$MAVEN_IMAGE" \
  --build-arg GATLING_VERSION="$GATLING_VERSION" --build-arg GATLING_MAVEN_PLUGIN_VERSION="$GATLING_MAVEN_PLUGIN_VERSION"

build "$tag_tools" lt-ci-tools \
  --build-arg LT_BASE_IMAGE="$base" --build-arg SHELLCHECK_IMAGE="$SHELLCHECK_IMAGE" --build-arg PIP_INDEX_URL="$PIP_INDEX_URL"

bash smoke-test.sh "$tag_jmeter" "$tag_k6" "$tag_gatling" "$tag_tools"

echo "Образы собраны. В .gitlab-ci.yml пайплайна прогонов фиксируются digest'ы:"
for tag in "$tag_jmeter" "$tag_k6" "$tag_gatling" "$tag_tools"; do
  docker buildx imagetools inspect "$tag" --format '{{.Name}}@{{.Manifest.Digest}}' 2>/dev/null || echo "$tag (digest доступен после --push)"
done
