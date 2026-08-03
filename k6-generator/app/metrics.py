"""Метрики k6-generator для VictoriaMetrics.

Сервис не ходит наружу (HTTP-клиент не нужен) — метрики описывают только генерацию:
длительность, успех/ошибка, формат артефакта и его размер.
"""
from __future__ import annotations

from prometheus_client import Counter, Histogram

GENERATE_DURATION = Histogram(
    "k6_generate_duration_seconds",
    "Длительность генерации k6-скрипта",
    labelnames=("format", "result"),
    buckets=(0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5),
)

GENERATE_TOTAL = Counter(
    "k6_generate_total",
    "Число попыток генерации k6-скрипта",
    labelnames=("format", "result"),
)

ARTIFACT_SIZE = Histogram(
    "k6_artifact_size_bytes",
    "Размер сгенерированного артефакта",
    labelnames=("format",),
    buckets=(1_000, 5_000, 10_000, 50_000, 100_000, 500_000, 1_000_000),
)
