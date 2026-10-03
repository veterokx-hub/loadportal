#!/usr/bin/env bash
# Проверка уже запущенного образа. Локальный офлайн-прогон — images/smoke-test.sh.
# Использование: selftest-inside.sh base|jmeter|k6|gatling|tools
set -euo pipefail

role="${1:?роль образа: base|jmeter|k6|gatling|tools}"

[ "$(id -u)" != 0 ]
command -v lt-run tini jq timeout >/dev/null

case "$role" in
  base) ;;
  jmeter)
    jmeter --version
    ls /opt/jmeter/lib/ext | grep -q jmeter-plugins-tst
    unzip -l /opt/jmeter/lib/ext/ApacheJMeter_components.jar | grep -q InfluxdbBackendListenerClient.class
    bzt --help >/dev/null
    ;;
  k6)
    k6 version
    ;;
  gatling)
    cp -r /opt/lt/selftest /tmp/st
    mvn -o -B -q -f /tmp/st/pom.xml -Dmaven.repo.local=/opt/m2 -Dgatling.noReports=true gatling:test
    ;;
  tools)
    python3 -c "import jsonschema, yaml"
    shellcheck --version >/dev/null
    ;;
  *)
    echo "ERROR: неизвестная роль '$role'" >&2
    exit 1
    ;;
esac

echo "selftest-inside ($role): OK"
