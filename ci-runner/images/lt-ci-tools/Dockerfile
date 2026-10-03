# syntax=docker/dockerfile:1.7
# lt-ci-tools: образ управляющих джоб (lint, pre-check, gate) на runner'е lt-control.
# Инструментов нагрузки здесь нет и быть не должно.
ARG SHELLCHECK_IMAGE
ARG LT_BASE_IMAGE
FROM ${SHELLCHECK_IMAGE} AS shellcheck

FROM ${LT_BASE_IMAGE}

ARG PIP_INDEX_URL

USER root

COPY --from=shellcheck /bin/shellcheck /usr/local/bin/shellcheck

RUN sh /usr/local/lib/lt/install-os-packages.sh python3 python3-venv \
 || sh /usr/local/lib/lt/install-os-packages.sh python3

COPY requirements.lock /tmp/requirements.lock
RUN python3 -m venv /opt/ci-tools \
 && /opt/ci-tools/bin/pip install --no-cache-dir --index-url "$PIP_INDEX_URL" --require-hashes -r /tmp/requirements.lock \
 && rm /tmp/requirements.lock

ENV PATH=/opt/ci-tools/bin:$PATH

USER 10001
