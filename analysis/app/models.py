"""Контракт модуля «Анализ» (snake_case JSON, зеркало frontend/lib/analysis.ts).

Вход — что анализировать (цель + окно + профиль нагрузки).
Выход — отчёт: фазы, находки, корреляции, гипотезы, покрытие.

См. docs/module-4-analysis.md.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field, model_validator


class Severity(str, Enum):
    """Порядок важен: сортировка находок и агрегат вердикта идут по нему."""

    CRITICAL = "critical"
    MAJOR = "major"
    MINOR = "minor"
    INFO = "info"


SEVERITY_ORDER: dict[str, int] = {
    Severity.CRITICAL: 0,
    Severity.MAJOR: 1,
    Severity.MINOR: 2,
    Severity.INFO: 3,
}


class Verdict(str, Enum):
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"
    INCONCLUSIVE = "inconclusive"


class PhaseKind(str, Enum):
    WARMUP = "warmup"
    RAMP = "ramp"
    PLATEAU = "plateau"
    STEP = "step"
    COOLDOWN = "cooldown"
    IDLE = "idle"


class DetectorKind(str, Enum):
    LEVEL = "level"
    DRIFT = "drift"
    INVARIANT = "invariant"
    EVENT = "event"
    CAPACITY = "capacity"


class TestKind(str, Enum):
    RAMP_HOLD = "ramp_hold"
    MAX_SEARCH = "max_search"
    ENDURANCE = "endurance"


class Runtime(str, Enum):
    JVM = "jvm"
    GO = "go"
    AUTO = "auto"


# ————————————————————————— вход —————————————————————————


class AnalysisTarget(BaseModel):
    """Что анализируем. Минимум для построения MetricsQL: cluster + namespace + service."""

    cluster: str = ""
    namespace: str = ""
    service: str = ""
    container: str = ""
    runtime: Runtime = Runtime.AUTO
    """Соседи по цепочке вызовов — попадают в корреляцию, но не в вердикт."""
    neighbors: list[str] = Field(default_factory=list)


class LoadProfile(BaseModel):
    """Заявленный профиль из модуля «Сценарий». Пустой профиль допустим — фазы найдём по факту."""

    test_kind: TestKind = TestKind.RAMP_HOLD
    target_rps: float = 0.0
    ramp_up_sec: int = 0
    hold_sec: int = 0
    steps: int = 0
    step_duration_sec: int = 0
    slo_p90_ms: float = 0.0
    slo_p99_ms: float = 0.0
    slo_error_rate_pct: float = 0.0


class AnalyzeRequest(BaseModel):
    run_id: str = ""
    test_id: str = ""
    target: AnalysisTarget = Field(default_factory=AnalysisTarget)
    """Ссылка на дашборд Grafana — альтернатива ручному вводу цели и окна."""
    grafana_url: str = ""
    window_from: datetime | None = None
    window_to: datetime | None = None
    profile: LoadProfile = Field(default_factory=LoadProfile)
    """Синтетика вместо VictoriaMetrics: демо UI и регрессионные прогоны детекторов."""
    demo: bool = False
    """Профиль дефекта для demo (leak / pool / throttle / clean). Пусто — выбор по run_id."""
    demo_fault: str = ""

    @model_validator(mode="after")
    def _window_sane(self) -> AnalyzeRequest:
        if self.window_from and self.window_to and self.window_from >= self.window_to:
            raise ValueError("window_from должен быть раньше window_to")
        return self


# ————————————————————————— выход —————————————————————————


class Spark(BaseModel):
    """Мини-график находки: чтобы не открывать Grafana ради формы кривой."""

    t: list[int] = Field(default_factory=list)
    v: list[float] = Field(default_factory=list)
    unit: str = ""
    baseline: float | None = None
    limit: float | None = None


class Phase(BaseModel):
    kind: PhaseKind
    from_ts: datetime
    to_ts: datetime
    """Средний RPS фазы; для step-фаз — ступень."""
    rps: float = 0.0
    label: str = ""
    """Фаза исключена из детектирования (прогрев, хвост после стопа)."""
    excluded: bool = False


class Evidence(BaseModel):
    """Числа, на которых стоит вывод. Каждое поле — то, что можно перепроверить руками."""

    observed: float | None = None
    baseline: float | None = None
    deviation_pct: float | None = None
    robust_z: float | None = None
    slope_per_hour: float | None = None
    slope_pct_per_hour: float | None = None
    kendall_tau: float | None = None
    p_value: float | None = None
    threshold: float | None = None
    breach_sec: float | None = None
    samples: int | None = None
    at_rps: float | None = None
    projection_hours: float | None = None


class Finding(BaseModel):
    id: str
    detector: DetectorKind
    severity: Severity
    """Ключ метрики из каталога, например jvm.gc.live_data."""
    metric: str
    metric_title: str
    unit: str = ""
    phase: PhaseKind | None = None
    from_ts: datetime
    to_ts: datetime
    """Одна фраза: что произошло. Показывается в заголовке карточки."""
    title: str
    """Человеческое объяснение с числами. 1–2 предложения."""
    summary: str
    """Что делать дальше — конкретное действие, а не «посмотрите метрики»."""
    next_step: str = ""
    evidence: Evidence = Field(default_factory=Evidence)
    spark: Spark = Field(default_factory=Spark)
    """0..100 — уверенность детектора; ниже 50 находка помечается «под вопросом»."""
    confidence: int = 100
    """MetricsQL, по которому получен ряд — чтобы перепроверить вывод руками."""
    query: str = ""
    labels: dict[str, str] = Field(default_factory=dict)


class Correlation(BaseModel):
    id: str
    """Находки, сложившиеся в один сюжет."""
    finding_ids: list[str] = Field(default_factory=list)
    from_ts: datetime
    to_ts: datetime
    severity: Severity
    title: str
    """Причинно-следственная цепочка в терминах метрик: что за чем потянулось."""
    chain: list[str] = Field(default_factory=list)
    summary: str
    confidence: int = 0


class Hypothesis(BaseModel):
    id: str
    """Совпавший паттерн из каталога, например jvm_heap_leak."""
    pattern: str
    title: str
    """Что, вероятно, происходит в коде. Формулировка гипотезы, не диагноза."""
    body: str
    """Куда смотреть в коде / конфиге — по пунктам."""
    checks: list[str] = Field(default_factory=list)
    confidence: int = 0
    severity: Severity = Severity.MAJOR
    finding_ids: list[str] = Field(default_factory=list)
    correlation_id: str = ""
    """deterministic — из каталога правил; llm — дополнено моделью."""
    source: str = "deterministic"


class Capacity(BaseModel):
    """Итог max_search: где сломалось и что упёрлось первым."""

    max_sustained_rps: float = 0.0
    knee_rps: float = 0.0
    knee_at: datetime | None = None
    first_limiter: str = ""
    first_limiter_title: str = ""
    reason: str = ""


class MetricCoverage(BaseModel):
    key: str
    title: str
    group: str
    status: str
    """ok — ряд есть; empty — метрики нет; error — источник не ответил."""
    points: int = 0


class Coverage(BaseModel):
    """Что реально удалось посмотреть. Без этого вердикт «всё хорошо» ничего не стоит."""

    requested: int = 0
    available: int = 0
    groups_ok: list[str] = Field(default_factory=list)
    groups_missing: list[str] = Field(default_factory=list)
    metrics: list[MetricCoverage] = Field(default_factory=list)
    """0..100 — доля покрытых метрик с весом по важности группы."""
    score: int = 0


class Cost(BaseModel):
    """Бюджет запроса к VictoriaMetrics — чтобы длинные тесты не роняли источник."""

    queries: int = 0
    points_fetched: int = 0
    duration_ms: int = 0
    step_sec: int = 0
    refined_metrics: int = 0
    degraded: bool = False
    degraded_reason: str = ""


class Validity(BaseModel):
    """Можно ли вообще доверять прогону: рестарты, смена образа, срабатывание autostop."""

    valid: bool = True
    reasons: list[str] = Field(default_factory=list)


class AnalysisReport(BaseModel):
    run_id: str = ""
    test_id: str = ""
    ruleset_version: str
    generated_at: datetime
    window_from: datetime
    window_to: datetime
    target: AnalysisTarget
    test_kind: TestKind
    verdict: Verdict
    """Одна фраза для человека, который смотрит только на неё."""
    headline: str
    """0..100 — здоровье прогона; 100 — ни одной находки."""
    health_score: int = 100
    validity: Validity = Field(default_factory=Validity)
    phases: list[Phase] = Field(default_factory=list)
    findings: list[Finding] = Field(default_factory=list)
    correlations: list[Correlation] = Field(default_factory=list)
    hypotheses: list[Hypothesis] = Field(default_factory=list)
    capacity: Capacity | None = None
    coverage: Coverage = Field(default_factory=Coverage)
    cost: Cost = Field(default_factory=Cost)
    """Подавленные находки: причина отсева. Прозрачность против «оно молчит»."""
    suppressed: list[str] = Field(default_factory=list)
    demo: bool = False
    """Какой дефект в итоге разыгран. В запросе поле может быть пустым — выбор идёт по
    хешу run_id, и повторить его снаружи нечем."""
    demo_fault: str = ""


class CatalogEntry(BaseModel):
    key: str
    title: str
    group: str
    unit: str
    runtime: str = "any"
    hint: str = ""


class CatalogResponse(BaseModel):
    ruleset_version: str
    metrics: list[CatalogEntry] = Field(default_factory=list)
    patterns: list[str] = Field(default_factory=list)


class TargetSuggestion(BaseModel):
    """Разбор ссылки на дашборд Grafana — предзаполнение формы."""

    target: AnalysisTarget
    window_from: datetime | None = None
    window_to: datetime | None = None
    dashboard_uid: str = ""
    matched: list[str] = Field(default_factory=list)
    unmatched: list[str] = Field(default_factory=list)


class ParseLinkRequest(BaseModel):
    url: str
