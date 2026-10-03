"""Метрики сервиса analysis для VictoriaMetrics.

Отвечают на три эксплуатационных вопроса: не деградировал ли сам анализ по
времени, сколько он стоит источнику метрик и не начал ли молчать (падение
числа находок на прогон обычно значит, что сломались имена рядов в каталоге).
"""
from __future__ import annotations

from prometheus_client import Counter, Histogram

ANALYZE_DURATION = Histogram(
    "analysis_duration_seconds",
    "Длительность полного анализа прогона",
    labelnames=("mode", "result"),
    buckets=(0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120),
)

ANALYZE_TOTAL = Counter(
    "analysis_total",
    "Число выполненных анализов",
    labelnames=("mode", "verdict"),
)

FINDINGS_TOTAL = Counter(
    "analysis_findings_total",
    "Находки по критичности",
    labelnames=("severity", "detector"),
)

SOURCE_QUERIES = Histogram(
    "analysis_source_queries",
    "Запросов в источник метрик на один анализ",
    buckets=(1, 5, 10, 25, 50, 100, 200),
)

SOURCE_POINTS = Histogram(
    "analysis_source_points",
    "Точек, вытянутых из источника на один анализ",
    buckets=(1_000, 5_000, 20_000, 50_000, 200_000, 500_000),
)

COVERAGE_SCORE = Histogram(
    "analysis_coverage_score",
    "Доля доступных метрик каталога, %",
    buckets=(10, 25, 40, 60, 75, 90, 100),
)
