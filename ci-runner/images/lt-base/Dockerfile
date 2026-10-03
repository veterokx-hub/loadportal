# syntax=docker/dockerfile:1.7
# lt-base: корпоративная база + то, что нужно любому генератору и lt-run.
# Инструменты нагрузки сюда не входят — они в lt-jmeter / lt-k6 / lt-gatling.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}

ARG TINI_URL
ARG TINI_SHA256

USER root

COPY install-os-packages.sh /usr/local/lib/lt/install-os-packages.sh
RUN sh /usr/local/lib/lt/install-os-packages.sh bash ca-certificates tzdata curl jq unzip \
 && for tool in bash curl jq unzip timeout sha256sum sha512sum awk find; do \
      command -v "$tool" >/dev/null || { echo "ERROR: в образе нет $tool" >&2; exit 1; }; \
    done

RUN curl -fsSL "$TINI_URL" -o /usr/local/bin/tini \
 && echo "$TINI_SHA256  /usr/local/bin/tini" | sha256sum -c - \
 && chmod 0755 /usr/local/bin/tini

# gid 0 + g=u: образ работает и под фиксированным uid 10001, и под произвольным uid (OpenShift).
RUN mkdir -p /home/lt /builds \
 && (getent passwd 10001 >/dev/null || echo "lt:x:10001:0:load generator:/home/lt:/bin/bash" >> /etc/passwd) \
 && chown -R 10001:0 /home/lt /builds \
 && chmod -R g=u /home/lt /builds

COPY --chmod=0755 lt-run /usr/local/bin/lt-run

ENV HOME=/home/lt \
    TZ=UTC \
    LANG=C.UTF-8

USER 10001
WORKDIR /home/lt

# tini -g: SIGTERM при удалении пода уходит всей группе процессов, и lt-run успевает
# остановить инструмент и записать meta.json. Требует FF_KUBERNETES_HONOR_ENTRYPOINT.
ENTRYPOINT ["/usr/local/bin/tini", "-g", "--"]
CMD ["bash"]
