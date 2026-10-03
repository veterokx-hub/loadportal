"""Метрики gatling-generator для VictoriaMetrics.

Сервис не ходит наружу — метрики описывают только генерацию: длительность,
успех/ошибка и размер артефакта (всегда zip: Gatling требует проект, не файл).
"""
from __future__ import annotations

from prometheus_client import Counter, Histogram

GENERATE_DURATION = Histogram(
    "gatling_generate_duration_seconds",
    "Длительность генерации Gatling-проекта",
    labelnames=("format", "result"),
    buckets=(0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5),
)

GENERATE_TOTAL = Counter(
    "gatling_generate_total",
    "Число попыток генерации Gatling-проекта",
    labelnames=("format", "result"),
)

ARTIFACT_SIZE = Histogram(
    "gatling_artifact_size_bytes",
    "Размер сгенерированного артефакта",
    labelnames=("format",),
    buckets=(1_000, 5_000, 10_000, 50_000, 100_000, 500_000, 1_000_000),
)
