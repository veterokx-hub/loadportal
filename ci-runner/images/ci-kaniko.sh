#!/usr/bin/env bash
# Сборка одного образа через kaniko и запись digest в digests/<name>.env.
# Джоба идёт в образе kaniko debug: нужен /kaniko/executor и shell.
# Пароль реестра в лог не пишется.
set -euo pipefail

name="${1:?имя образа: base|jmeter|k6|gatling|tools}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root/images"
# shellcheck source=/dev/null
source versions.env

registry="${LT_REGISTRY:-}"
case "$registry" in
  ""|*example*|*REPLACE_ME*)
    echo "ERROR: LT_REGISTRY='$registry' — подставьте реестр, куда runner умеет пушить" >&2
    exit 1
    ;;
esac
if ! printf '%s' "$registry" | grep -Eq '^[A-Za-z0-9._:/-]+$'; then
  echo "ERROR: LT_REGISTRY содержит недопустимые символы" >&2
  exit 1
fi

if grep -q REPLACE_ME versions.env lt-jmeter/jmeter-plugins.lock; then
  echo "ERROR: в versions.env или jmeter-plugins.lock остались REPLACE_ME" >&2
  exit 1
fi

user="${LT_REGISTRY_USER:-${CI_REGISTRY_USER:-}}"
pass="${LT_REGISTRY_PASSWORD:-${CI_REGISTRY_PASSWORD:-}}"
if [ -z "$user" ] || [ -z "$pass" ]; then
  echo "ERROR: задайте LT_REGISTRY_USER и LT_REGISTRY_PASSWORD (или CI_REGISTRY_USER/PASSWORD)" >&2
  exit 1
fi
if [ ! -x /kaniko/executor ]; then
  echo "ERROR: /kaniko/executor не найден — джоба должна идти в образе kaniko debug" >&2
  exit 1
fi

# auth — base64(user:pass), чтобы спецсимволы пароля не ломали JSON.
auth="$(printf '%s:%s' "$user" "$pass" | base64 | tr -d '\n')"
mkdir -p /kaniko/.docker
umask 077
printf '{"auths":{"%s":{"auth":"%s"}}}\n' "$registry" "$auth" > /kaniko/.docker/config.json
unset auth pass

rev="r${REVISION}"
k6_tag="$(echo "$K6_IMAGE" | sed -n 's|.*:\([^@]*\)@.*|\1|p')"
args=()
case "$name" in
  base)
    context="lt-base"
    dest="$registry/lt-base:$rev"
    args+=(--build-arg "BASE_IMAGE=$BASE_IMAGE" --build-arg "TINI_URL=$TINI_URL" --build-arg "TINI_SHA256=$TINI_SHA256")
    ;;
  jmeter)
    context="lt-jmeter"
    dest="$registry/lt-jmeter:${JMETER_VERSION}-$rev"
    args+=(
      --build-arg "LT_BASE_IMAGE=$registry/lt-base:$rev"
      --build-arg "JRE_IMAGE=$JRE21_IMAGE"
      --build-arg "JMETER_VERSION=$JMETER_VERSION"
      --build-arg "JMETER_URL=$JMETER_URL"
      --build-arg "JMETER_SHA512=$JMETER_SHA512"
      --build-arg "PIP_INDEX_URL=$PIP_INDEX_URL"
    )
    ;;
  k6)
    context="lt-k6"
    dest="$registry/lt-k6:${k6_tag}-$rev"
    args+=(--build-arg "LT_BASE_IMAGE=$registry/lt-base:$rev" --build-arg "K6_IMAGE=$K6_IMAGE")
    ;;
  gatling)
    context="lt-gatling"
    dest="$registry/lt-gatling:${GATLING_VERSION}-jdk17-$rev"
    if [ -n "${MAVEN_SETTINGS:-}" ]; then
      cp "$MAVEN_SETTINGS" lt-gatling/maven-settings.xml
    fi
    args+=(
      --build-arg "LT_BASE_IMAGE=$registry/lt-base:$rev"
      --build-arg "JDK_IMAGE=$JDK17_IMAGE"
      --build-arg "MAVEN_IMAGE=$MAVEN_IMAGE"
      --build-arg "GATLING_VERSION=$GATLING_VERSION"
      --build-arg "GATLING_MAVEN_PLUGIN_VERSION=$GATLING_MAVEN_PLUGIN_VERSION"
    )
    ;;
  tools)
    context="lt-ci-tools"
    dest="$registry/lt-ci-tools:$rev"
    args+=(
      --build-arg "LT_BASE_IMAGE=$registry/lt-base:$rev"
      --build-arg "SHELLCHECK_IMAGE=$SHELLCHECK_IMAGE"
      --build-arg "PIP_INDEX_URL=$PIP_INDEX_URL"
    )
    ;;
  *)
    echo "ERROR: неизвестный образ '$name'" >&2
    exit 1
    ;;
esac

mkdir -p "$root/digests"
digest_file="$root/digests/${name}.digest"
/kaniko/executor \
  --context "$PWD/$context" \
  --dockerfile "$PWD/$context/Dockerfile" \
  --destination "$dest" \
  --digest-file "$digest_file" \
  --customPlatform "${PLATFORM:-linux/amd64}" \
  --snapshot-mode=redo \
  --compressed-caching=false \
  "${args[@]}"

digest="$(tr -d '[:space:]' < "$digest_file")"
case "$digest" in
  sha256:*) ;;
  *) echo "ERROR: kaniko не записал digest в $digest_file" >&2; exit 1 ;;
esac

var="LT_REF_$(printf '%s' "$name" | tr '[:lower:]' '[:upper:]')"
printf '%s=%s\n' "$var" "${dest}@${digest}" > "$root/digests/${name}.env"
echo "INFO: ${dest}@${digest}"
