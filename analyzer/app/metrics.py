"""Метрики analyzer для VictoriaMetrics.

Экспозиция — стандартный Prometheus text format на /metrics.
Теги низкой кардинальности: тип источника и результат. Имена сценариев и URL
в метрики не попадают — иначе число временных рядов будет неограниченно расти.
"""
from __future__ import annotations

from prometheus_client import Counter, Histogram

# Длительность разбора спецификации. Бакеты подобраны под типичные OpenAPI
# (миллисекунды) и тяжёлые Postman-коллекции (секунды).
ANALYZE_DURATION = Histogram(
    "analyzer_analyze_duration_seconds",
    "Длительность разбора спецификации",
    labelnames=("source_type", "result"),
    buckets=(0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30),
)

# Счётчик попыток: по нему видно долю ошибок без обращения к гистограмме.
ANALYZE_TOTAL = Counter(
    "analyzer_analyze_total",
    "Число попыток разбора спецификации",
    labelnames=("source_type", "result"),
)

# Сколько запросов попало в черновик сценария — индикатор «толщины» входных спек.
REQUESTS_IN_DRAFT = Histogram(
    "analyzer_draft_requests",
    "Число запросов в собранном ScenarioDraft",
    buckets=(1, 5, 10, 25, 50, 100, 250, 500),
)

# Загрузка спеки по URL: отдельно от разбора, чтобы видеть сетевые проблемы.
FETCH_DURATION = Histogram(
    "analyzer_fetch_duration_seconds",
    "Длительность загрузки спецификации по URL",
    labelnames=("result",),
    buckets=(0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20),
)
