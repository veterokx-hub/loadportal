# syntax=docker/dockerfile:1.7
# lt-jmeter: JMeter + плагины портала + Taurus как лаунчер.
# Всё скачивается при сборке с проверкой контрольных сумм; в рантайме сеть до
# интернета не нужна, автоустановка Taurus выключена (/etc/bzt.d/90-lt.yml).
ARG JRE_IMAGE
ARG LT_BASE_IMAGE
FROM ${JRE_IMAGE} AS jre

FROM ${LT_BASE_IMAGE}

ARG JMETER_VERSION
ARG JMETER_URL
ARG JMETER_SHA512
ARG PIP_INDEX_URL

USER root

COPY --from=jre /opt/java/openjdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk \
    PATH=/opt/java/openjdk/bin:/opt/jmeter/bin:/opt/bzt/bin:$PATH

RUN sh /usr/local/lib/lt/install-os-packages.sh python3 python3-venv \
 || sh /usr/local/lib/lt/install-os-packages.sh python3

RUN curl -fsSL "$JMETER_URL" -o /tmp/jmeter.tgz \
 && echo "$JMETER_SHA512  /tmp/jmeter.tgz" | sha512sum -c - \
 && mkdir -p /opt/jmeter \
 && tar -xzf /tmp/jmeter.tgz -C /opt/jmeter --strip-components=1 \
 && rm -rf /tmp/jmeter.tgz /opt/jmeter/docs /opt/jmeter/printable_docs

# Формат строки: <каталог в /opt/jmeter> <url> <sha256>. Пустые строки и # пропускаются.
COPY jmeter-plugins.lock /tmp/jmeter-plugins.lock
RUN grep -Ev '^[[:space:]]*(#|$)' /tmp/jmeter-plugins.lock | while read -r dir url sha; do \
      case "$sha" in *REPLACE_ME*) echo "ERROR: не задан sha256 для $url" >&2; exit 1 ;; esac; \
      file="/opt/jmeter/$dir/$(basename "$url")"; \
      curl -fsSL "$url" -o "$file" && echo "$sha  $file" | sha256sum -c - || exit 1; \
    done \
 && rm /tmp/jmeter-plugins.lock

COPY bzt.lock /tmp/bzt.lock
RUN python3 -m venv /opt/bzt \
 && /opt/bzt/bin/pip install --no-cache-dir --index-url "$PIP_INDEX_URL" --require-hashes -r /tmp/bzt.lock \
 && rm /tmp/bzt.lock

COPY bzt-lt.yml /etc/bzt.d/90-lt.yml

# jmeter.sh читает HEAP: хип от лимита контейнера, а не зашитый -Xmx1g.
# Запас 30% — metaspace, стеки потоков, direct-буферы сокетов и сам Taurus.
ENV HEAP="-XX:InitialRAMPercentage=70 -XX:MaxRAMPercentage=70 -XX:MaxMetaspaceSize=256m" \
    JVM_ARGS="-XX:+ExitOnOutOfMemoryError -Djava.security.egd=file:/dev/urandom"

RUN chown -R 10001:0 /opt/jmeter && chmod -R g=u /opt/jmeter

USER 10001
