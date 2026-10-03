"""analysis — сервис поиска аномалий в метриках сервиса после нагрузочного теста.

Вход: цель (кластер / namespace / сервис), окно теста, профиль нагрузки.
Выход: фазы теста, находки с доказательствами, корреляции и гипотезы о причине.

Детерминированная реализация: те же данные дают тот же отчёт. Точка расширения
для ИИ — hypotheses.enrich(), переписывает формулировки, но не порождает факты.
"""
from __future__ import annotations

import hmac
import logging
import time
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, Request, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from . import grafana_link, pipeline
from .catalog import CATALOG
from .metrics import (
    ANALYZE_DURATION,
    ANALYZE_TOTAL,
    COVERAGE_SCORE,
    FINDINGS_TOTAL,
    SOURCE_POINTS,
    SOURCE_QUERIES,
)
from .models import (
    AnalysisReport,
    AnalyzeRequest,
    CatalogEntry,
    CatalogResponse,
    ParseLinkRequest,
    TargetSuggestion,
)
from .external_config import demo_forced, internal_token, vm as load_vm
from .vm import VictoriaMetricsClient

log = logging.getLogger(__name__)

_INTERNAL_TOKEN = internal_token()
_VM_URL, _VM_CONCURRENCY, _VM_TIMEOUT, _VM_BEARER = load_vm()
# Стенд без VictoriaMetrics: модуль работает на синтетике и честно помечает отчёт.
_FORCE_DEMO = demo_forced()

_state: dict[str, object] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Один HTTP-клиент на процесс: анализ делает десятки запросов подряд,
    поднимать пул TCP/TLS на каждый — лишние рукопожатия и дескрипторы."""
    client = httpx.AsyncClient(timeout=_VM_TIMEOUT, follow_redirects=False, verify=False)
    _state["http"] = client
    _state["vm"] = VictoriaMetricsClient(
        _VM_URL, client, _VM_CONCURRENCY, _VM_TIMEOUT, _VM_BEARER
    )
    log.info(
        "analysis готов: источник=%s, правила=%s, метрик в каталоге=%d",
        _VM_URL or "не задан (демо-режим)",
        CATALOG.ruleset_version,
        len(CATALOG.metrics),
    )
    try:
        yield
    finally:
        await client.aclose()
        _state.clear()


app = FastAPI(title="Load Test Portal — Analysis", version="0.1.0", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "analysis"}


@app.get("/ready")
def ready() -> dict[str, str]:
    """Отсутствие VictoriaMetrics не делает сервис неготовым: демо-режим работает всегда."""
    return {
        "status": "ok",
        "service": "analysis",
        "source": "victoriametrics" if _vm().configured and not _FORCE_DEMO else "demo",
    }


@app.get("/metrics")
def metrics() -> Response:
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/catalog", response_model=CatalogResponse)
def catalog(request: Request) -> CatalogResponse:
    """Что модуль умеет смотреть. UI показывает это до запуска анализа."""
    _require_internal(request.headers.get("X-Internal-Token"))
    entries = [
        CatalogEntry(
            key=spec.key,
            title=spec.title,
            group=spec.group,
            unit=spec.unit,
            runtime=spec.runtime,
            hint=spec.hint,
        )
        for spec in list(CATALOG.metrics.values()) + list(CATALOG.derived.values())
    ]
    entries.sort(key=lambda e: (e.group, e.title))
    return CatalogResponse(
        ruleset_version=CATALOG.ruleset_version,
        metrics=entries,
        patterns=[p.id for p in CATALOG.patterns],
    )


@app.post("/parse-link", response_model=TargetSuggestion)
def parse_link(body: ParseLinkRequest, request: Request) -> TargetSuggestion:
    """Разбор ссылки на дашборд. Сервер по ссылке не ходит — только парсит."""
    _require_internal(request.headers.get("X-Internal-Token"))
    if not body.url.strip():
        raise HTTPException(status_code=400, detail="Пустая ссылка")
    return grafana_link.parse(body.url)


@app.post("/analyze", response_model=AnalysisReport)
async def analyze(req: AnalyzeRequest, request: Request) -> AnalysisReport:
    _require_internal(request.headers.get("X-Internal-Token"))
    if req.grafana_url:
        _apply_link(req)
    if not req.demo and not _FORCE_DEMO and not (req.target.namespace and req.target.service):
        raise HTTPException(
            status_code=400,
            detail="Нужны namespace и сервис: заполните поля или вставьте ссылку на дашборд",
        )

    mode = "demo" if req.demo or _FORCE_DEMO else "live"
    started = time.perf_counter()
    try:
        report = await pipeline.analyze(req, None if _FORCE_DEMO else _vm())
    except Exception:
        ANALYZE_DURATION.labels(mode=mode, result="failure").observe(time.perf_counter() - started)
        ANALYZE_TOTAL.labels(mode=mode, verdict="error").inc()
        raise

    ANALYZE_DURATION.labels(mode=mode, result="success").observe(time.perf_counter() - started)
    ANALYZE_TOTAL.labels(mode=mode, verdict=report.verdict.value).inc()
    SOURCE_QUERIES.observe(report.cost.queries)
    SOURCE_POINTS.observe(report.cost.points_fetched)
    COVERAGE_SCORE.observe(report.coverage.score)
    for finding in report.findings:
        FINDINGS_TOTAL.labels(severity=finding.severity.value, detector=finding.detector.value).inc()
    return report


def _apply_link(req: AnalyzeRequest) -> None:
    """Ссылка дополняет форму, но не затирает то, что человек ввёл руками."""
    hint = grafana_link.parse(req.grafana_url)
    for field in ("cluster", "namespace", "service", "container"):
        if not getattr(req.target, field):
            setattr(req.target, field, getattr(hint.target, field))
    if req.window_from is None:
        req.window_from = hint.window_from
    if req.window_to is None:
        req.window_to = hint.window_to


def _vm() -> VictoriaMetricsClient:
    client = _state.get("vm")
    if not isinstance(client, VictoriaMetricsClient):
        raise RuntimeError("Клиент источника метрик не инициализирован")
    return client


def _require_internal(token: str | None) -> None:
    if not _INTERNAL_TOKEN:
        return
    if not _tokens_equal(_INTERNAL_TOKEN, token or ""):
        raise HTTPException(status_code=401, detail="Требуется внутренний токен")


def _tokens_equal(expected: str, provided: str) -> bool:
    left = hmac.new(b"ltp", expected.encode(), "sha256").digest()
    right = hmac.new(b"ltp", provided.encode(), "sha256").digest()
    return hmac.compare_digest(left, right)
