#!/usr/bin/env bash
# Офлайн-самопроверка образов: генератор обязан работать без сети до интернета и Nexus.
# Использование: smoke-test.sh <lt-jmeter> <lt-k6> <lt-gatling> <lt-ci-tools>
set -euo pipefail

jmeter="$1" k6="$2" gatling="$3" tools="$4"

# --network none ловит скрытые загрузки в рантайме; произвольный uid с gid 0 — запуск под OpenShift.
run() { docker run --rm --platform linux/amd64 --network none "$@"; }

for image in "$jmeter" "$k6" "$gatling" "$tools"; do
  echo "--- $image"
  # shellcheck disable=SC2016 # раскрывается внутри контейнера
  run "$image" sh -c '[ "$(id -u)" != 0 ] && command -v lt-run tini jq timeout >/dev/null'
done

run "$jmeter" jmeter --version
# TST — из lock. InfluxdbBackendListenerClient — штатный класс JMeter, отдельный jar не ставится.
run "$jmeter" sh -c 'ls /opt/jmeter/lib/ext | grep -q jmeter-plugins-tst && unzip -l /opt/jmeter/lib/ext/ApacheJMeter_components.jar | grep -q InfluxdbBackendListenerClient.class'
run "$jmeter" bzt --help >/dev/null

run "$k6" k6 version

# Полный цикл Maven + Gatling без сети: доказывает, что /opt/m2 прогрет целиком.
run --user 12345:0 "$gatling" sh -c \
  'cp -r /opt/lt/selftest /tmp/st && mvn -o -B -q -f /tmp/st/pom.xml -Dmaven.repo.local=/opt/m2 -Dgatling.noReports=true gatling:test'

run "$tools" sh -c 'python3 -c "import jsonschema, yaml" && shellcheck --version >/dev/null'

echo "smoke-test: OK"
