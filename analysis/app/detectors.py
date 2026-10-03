"""Детекторы аномалий.

Четыре независимых механизма, намеренно простых и объяснимых:

  D1 «уровень»  — робастная z-оценка внутри фазы: значение ушло от медианы фазы
                  и держалось там. Ловит ступенчатые сдвиги.
  D2 «дрейф»    — наклон Theil–Sen плюс тест Манна–Кендалла на плато. Ловит утечки
                  и медленную деградацию, которые по уровню незаметны.
  D3 «инвариант»— декларативные правила из rules.yaml: то, чего быть не должно
                  независимо от статистики (ошибки выше SLO, очередь за пулом).
  D4 «событие»  — дискретные факты платформы: рестарт, OOMKilled, потеря реплик.

Ни один вывод не строится на одной точке: везде требуется персистентность,
минимальная амплитуда и робастная база. Это цена против alert fatigue.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime

import numpy as np

from . import fmt, stats
from .catalog import CATALOG, Invariant
from .models import (
    Capacity,
    DetectorKind,
    Evidence,
    Finding,
    LoadProfile,
    Phase,
    PhaseKind,
    Severity,
    SEVERITY_ORDER,
    Spark,
    TestKind,
)
from .series import Series

STATISTICAL_PHASES = (PhaseKind.PLATEAU, PhaseKind.STEP)
SPARK_POINTS = 48


def _breach_sec(run_len: int, step: float) -> float:
    """Длительность отклонения — промежуток между первой и последней точкой серии.

    Умножать число точек на шаг нельзя: две точки при шаге 60 с дают 120 с, и любой
    одиночный сетевой всплеск проходит фильтр персистентности в 90 с. Наблюдённый факт —
    ровно 60 с между двумя замерами; всё остальное домыслено за края.
    """
    return max(run_len - 1, 0) * step


@dataclass
class DetectorContext:
    series: dict[str, Series]
    queries: dict[str, str]
    phases: list[Phase]
    profile: LoadProfile
    suppressed: list[str] = field(default_factory=list)

    @property
    def cfg(self) -> dict:
        return CATALOG.detectors


def run_all(ctx: DetectorContext) -> list[Finding]:
    findings = _level(ctx) + _drift(ctx) + _rules(ctx)
    return _dedupe(findings, ctx)


# ————————————————————————— D1: сдвиг уровня —————————————————————————


def _level(ctx: DetectorContext) -> list[Finding]:
    cfg = ctx.cfg.get("level", {})
    z_threshold = float(cfg.get("z_threshold", 4.0))
    min_dev = float(cfg.get("min_deviation_pct", 20.0))
    persistence = float(cfg.get("persistence_sec", 90))
    floor_pct = float(cfg.get("scale_floor_pct", 2.0))
    skip = set(ctx.cfg.get("skip_statistical", []))

    out: list[Finding] = []
    for key, series in ctx.series.items():
        if key in skip or series.empty:
            continue
        for phase in _phases(ctx, STATISTICAL_PHASES):
            chunk = series.window(_epoch(phase.from_ts), _epoch(phase.to_ts))
            if chunk.v.size < 10:
                continue
            center, scale = stats.robust_center_scale(chunk.v)
            floor = max(abs(center) * floor_pct / 100.0, 1e-9)
            z = stats.robust_z(chunk.v, center, scale, floor)
            deviation = np.abs(chunk.v - center) / max(abs(center), 1e-9) * 100.0
            mask = (np.abs(z) > z_threshold) & (deviation > min_dev)

            run_len, i0, i1 = stats.longest_true_run(mask)
            step = chunk.step_sec() or 1.0
            breach_sec = _breach_sec(run_len, step)
            if breach_sec < persistence:
                continue

            observed = float(np.median(chunk.v[i0 : i1 + 1]))
            dev_pct = fmt.delta_pct(observed, center)
            # Уровень был около нуля: процента нет, но уход от нуля — это как раз
            # большое изменение, а не отсутствие его.
            dev_weight = 100.0 if dev_pct is None else abs(dev_pct)
            up = observed > center
            severity = (
                Severity.MAJOR
                if CATALOG.importance(key) >= 3 and dev_weight >= 50
                else Severity.MINOR
            )
            out.append(
                _finding(
                    ctx,
                    detector=DetectorKind.LEVEL,
                    key=key,
                    phase=phase,
                    from_ts=int(chunk.t[i0]),
                    to_ts=int(chunk.t[i1]),
                    severity=severity,
                    title=f"{series.title}: {'скачок' if up else 'провал'} на фазе «{phase.label}»",
                    summary=(
                        f"{fmt.value(observed, series.unit)} против обычных "
                        f"{fmt.value(center, series.unit)} для этой фазы"
                        + (f" ({fmt.signed_pct(dev_pct)})" if dev_pct is not None else "")
                        + f", держалось {fmt.duration(breach_sec)}."
                    ),
                    next_step=_level_next_step(key, up),
                    evidence=Evidence(
                        observed=observed,
                        baseline=center,
                        deviation_pct=dev_pct,
                        robust_z=float(np.median(z[i0 : i1 + 1])),
                        breach_sec=breach_sec,
                        samples=int(chunk.v.size),
                        at_rps=phase.rps,
                    ),
                    chunk=chunk,
                    baseline=center,
                    confidence=min(100, 55 + int(min(dev_weight, 100) / 3)),
                    direction="up" if up else "down",
                )
            )
    return out


# ————————————————————————— D2: дрейф —————————————————————————


def _drift(ctx: DetectorContext) -> list[Finding]:
    cfg = ctx.cfg.get("drift", {})
    p_max = float(cfg.get("p_value", 0.01))
    min_slope_pct = float(cfg.get("min_slope_pct_per_hour", 4.0))
    min_duration = float(cfg.get("min_duration_sec", 900))
    min_effect = float(cfg.get("min_effect_sigma", 1.5))
    limits: dict[str, str] = cfg.get("project_to_limit", {}) or {}
    skip = set(ctx.cfg.get("skip_statistical", [])) | set(
        CATALOG.expected.get("sawtooth", [])
    )

    out: list[Finding] = []
    for key, series in ctx.series.items():
        if key in skip or series.empty:
            continue
        for phase in _phases(ctx, STATISTICAL_PHASES):
            start, stop = _epoch(phase.from_ts), _epoch(phase.to_ts)
            if stop - start < min_duration:
                continue
            chunk = series.window(start, stop)
            if chunk.v.size < 16:
                continue

            rel = (chunk.t - chunk.t[0]).astype(float)
            slope_sec = stats.theil_sen(rel, chunk.v)
            tau, p_value = stats.mann_kendall(chunk.v)
            base = abs(float(np.median(chunk.v)))
            slope_hour = slope_sec * 3600.0
            pct_hour = slope_hour / base * 100.0 if base > 1e-9 else 0.0
            if p_value > p_max or abs(pct_hour) < min_slope_pct:
                continue
            # Тест Манна–Кендалла отвечает «тренд есть», но не «тренд заметен»:
            # на длинном шумном ряде значимым становится наклон в доли процента.
            # Требуем, чтобы накопленное изменение перекрыло собственный разброс ряда.
            _, scale = stats.robust_center_scale(chunk.v)
            total_change = abs(slope_sec) * float(rel[-1])
            if scale > 0 and total_change < min_effect * scale:
                ctx.suppressed.append(
                    f"{series.title}: тренд статистически значим, но его величина меньше "
                    "обычного разброса метрики — это шум, а не деградация"
                )
                continue

            up = slope_hour > 0
            projection = _projection(ctx, key, limits, chunk, slope_hour)
            severity = _drift_severity(key, projection, abs(pct_hour))
            out.append(
                _finding(
                    ctx,
                    detector=DetectorKind.DRIFT,
                    key=key,
                    phase=phase,
                    from_ts=int(chunk.t[0]),
                    to_ts=int(chunk.t[-1]),
                    severity=severity,
                    title=f"{series.title}: {'растёт' if up else 'снижается'} при стабильной нагрузке",
                    summary=_drift_summary(series, chunk, slope_hour, pct_hour, projection),
                    next_step=_drift_next_step(key, up),
                    evidence=Evidence(
                        observed=float(chunk.v[-1]),
                        baseline=float(chunk.v[0]),
                        slope_per_hour=slope_hour,
                        slope_pct_per_hour=pct_hour,
                        kendall_tau=tau,
                        p_value=p_value,
                        samples=int(chunk.v.size),
                        at_rps=phase.rps,
                        projection_hours=projection,
                    ),
                    chunk=chunk,
                    baseline=float(chunk.v[0]),
                    confidence=min(100, 60 + int(abs(tau) * 40)),
                    direction="up" if up else "down",
                )
            )
    return out


def _projection(
    ctx: DetectorContext, key: str, limits: dict[str, str], chunk: Series, slope_hour: float
) -> float | None:
    """Через сколько часов такой рост упрётся в лимит. Только для рядов с лимитом."""
    limit_key = limits.get(key)
    if not limit_key or slope_hour <= 0:
        return None
    limit_series = ctx.series.get(limit_key)
    if limit_series is None or limit_series.empty:
        return None
    headroom = limit_series.median() - float(chunk.v[-1])
    if headroom <= 0:
        return 0.0
    return round(headroom / slope_hour, 1)


def _drift_severity(key: str, projection: float | None, pct_hour: float) -> Severity:
    if projection is not None and projection <= 8:
        return Severity.CRITICAL
    if CATALOG.importance(key) >= 3 and pct_hour >= 10:
        return Severity.MAJOR
    return Severity.MINOR if CATALOG.importance(key) < 3 else Severity.MAJOR


def _drift_summary(
    series: Series, chunk: Series, slope_hour: float, pct_hour: float, projection: float | None
) -> str:
    text = (
        f"За {fmt.duration(int(chunk.t[-1] - chunk.t[0]))} значение выросло с "
        f"{fmt.value(float(chunk.v[0]), series.unit)} до {fmt.value(float(chunk.v[-1]), series.unit)} "
        f"— это {fmt.value(abs(slope_hour), series.unit)} в час ({fmt.signed_pct(pct_hour)} в час)."
    )
    if projection is not None:
        text += (
            " При таком темпе лимит будет достигнут примерно через "
            f"{fmt.duration(projection * 3600)}."
            if projection > 0
            else " Лимит уже достигнут."
        )
    return text


# ————————————————————————— D3/D4: инварианты и события —————————————————————————


def _rules(ctx: DetectorContext) -> list[Finding]:
    out: list[Finding] = []
    for rule in CATALOG.invariants:
        series = ctx.series.get(rule.metric)
        if series is None or series.empty:
            continue
        if rule.op == "increase":
            found = _rule_increase(ctx, rule, series)
        else:
            found = _rule_threshold(ctx, rule, series)
        out.extend(found)
    return out


def _rule_increase(ctx: DetectorContext, rule: Invariant, series: Series) -> list[Finding]:
    """Счётчик вырос за окно — дискретное событие платформы."""
    delta = series.last() - series.first()
    if delta <= rule.value:
        return []
    return [
        _finding(
            ctx,
            detector=DetectorKind.EVENT,
            key=rule.metric,
            phase=None,
            from_ts=int(series.t[0]),
            to_ts=int(series.t[-1]),
            severity=Severity(rule.severity),
            title=rule.title,
            summary=rule.summary.format(
                observed=fmt.value(delta, series.unit), threshold="", breach=""
            ),
            next_step=rule.next_step,
            evidence=Evidence(observed=delta, baseline=series.first(), samples=int(series.v.size)),
            chunk=series,
            baseline=series.first(),
            confidence=100,
            direction="up",
            rule_id=rule.id,
            rule_class=rule.cls,
        )
    ]


def _rule_threshold(ctx: DetectorContext, rule: Invariant, series: Series) -> list[Finding]:
    threshold = _threshold(ctx, rule, series)
    if threshold is None:
        return []

    scopes: list[Phase | None] = (
        [p for p in _phases(ctx, tuple(PhaseKind(k) for k in rule.phases))]
        if rule.phases
        else [None]
    )
    out: list[Finding] = []
    for phase in scopes:
        chunk = (
            series.window(_epoch(phase.from_ts), _epoch(phase.to_ts)) if phase else series
        )
        if chunk.v.size < 3:
            continue
        mask = _compare(chunk.v, rule.op, threshold)
        run_len, i0, i1 = stats.longest_true_run(mask)
        step = chunk.step_sec() or 1.0
        breach_sec = _breach_sec(run_len, step)
        if run_len == 0 or breach_sec < rule.for_sec:
            continue

        breach = chunk.v[i0 : i1 + 1]
        observed = float(np.max(breach) if rule.op in ("gt", "gte") else np.min(breach))
        out.append(
            _finding(
                ctx,
                detector=DetectorKind.EVENT if rule.cls == "platform" else DetectorKind.INVARIANT,
                key=rule.metric,
                phase=phase,
                from_ts=int(chunk.t[i0]),
                to_ts=int(chunk.t[i1]),
                severity=Severity(rule.severity),
                title=rule.title,
                summary=rule.summary.format(
                    observed=fmt.value(observed, series.unit),
                    threshold=fmt.value(threshold, series.unit),
                    breach=fmt.duration(breach_sec),
                ),
                next_step=rule.next_step,
                evidence=Evidence(
                    observed=observed,
                    threshold=threshold,
                    deviation_pct=fmt.delta_pct(observed, threshold),
                    breach_sec=breach_sec,
                    samples=int(chunk.v.size),
                    at_rps=phase.rps if phase else 0.0,
                ),
                chunk=chunk,
                baseline=threshold,
                limit=threshold,
                confidence=95,
                direction="up" if rule.op in ("gt", "gte") else "down",
                rule_id=rule.id,
                rule_class=rule.cls,
            )
        )
    return out


def _threshold(ctx: DetectorContext, rule: Invariant, series: Series) -> float | None:
    """Порог правила: из SLO сценария, из базы прогрева или из константы.

    None означает «правило неприменимо». Ноль — полноценный порог: очередь за
    соединением к пулу считается нарушением при любом устойчивом значении.
    """
    if rule.slo_from:
        slo = float(getattr(ctx.profile, rule.slo_from, 0.0) or 0.0) * rule.slo_scale
        if slo > 0:
            return slo
        # SLO не задан в сценарии: держимся константы правила, а при её отсутствии молчим.
        return rule.value if rule.value > 0 else None
    if rule.baseline_from_phase:
        base_phase = next(
            (p for p in ctx.phases if p.kind.value == rule.baseline_from_phase), None
        )
        reference = (
            series.window(_epoch(base_phase.from_ts), _epoch(base_phase.to_ts))
            if base_phase
            else series
        )
        base = reference.median() if not reference.empty else series.first()
        return base * rule.baseline_ratio if base > 0 else None
    return rule.value


def _compare(values: np.ndarray, op: str, threshold: float) -> np.ndarray:
    match op:
        case "gt":
            return values > threshold
        case "gte":
            return values >= threshold
        case "lt":
            return values < threshold
        case "lte":
            return values <= threshold
        case _:
            return np.zeros_like(values, dtype=bool)


# ————————————————————————— ёмкость (max_search) —————————————————————————


def capacity(ctx: DetectorContext, findings: list[Finding]) -> Capacity | None:
    """Для поиска максимума деградация ожидаема — вопрос не «есть ли», а «где и обо что»."""
    if ctx.profile.test_kind != TestKind.MAX_SEARCH:
        return None
    steps = [p for p in ctx.phases if p.kind == PhaseKind.STEP and not p.excluded]
    if len(steps) < 2:
        return None

    errors = ctx.series.get("http.error_rate")
    latency = ctx.series.get("http.rt.p99")
    slo_err = ctx.profile.slo_error_rate_pct or 1.0
    slo_lat = (ctx.profile.slo_p99_ms or 0.0) / 1000.0

    baseline_lat = 0.0
    max_ok = 0.0
    knee_rps = 0.0
    knee_at: datetime | None = None
    reason = ""

    for i, phase in enumerate(steps):
        window = (_epoch(phase.from_ts), _epoch(phase.to_ts))
        err = errors.window(*window).median() if errors and not errors.empty else 0.0
        lat = latency.window(*window).median() if latency and not latency.empty else 0.0
        if i == 0:
            baseline_lat = lat

        broke = ""
        if err > slo_err:
            broke = f"доля ошибок {fmt.value(err, 'percent')} превысила {fmt.value(slo_err, 'percent')}"
        elif slo_lat and lat > slo_lat:
            broke = f"p99 {fmt.value(lat, 'seconds')} превысил SLO {fmt.value(slo_lat, 'seconds')}"
        elif baseline_lat > 0 and lat > baseline_lat * 2:
            broke = f"p99 вырос вдвое от первой ступени ({fmt.value(lat, 'seconds')})"

        if broke and not knee_at:
            knee_rps = phase.rps
            knee_at = phase.from_ts
            reason = broke
        if not broke and not knee_at:
            max_ok = phase.rps

    limiter = min(
        (f for f in findings if f.labels.get("class") == "saturation"),
        key=lambda f: f.from_ts,
        default=None,
    )
    return Capacity(
        max_sustained_rps=round(max_ok, 1),
        knee_rps=round(knee_rps, 1),
        knee_at=knee_at,
        first_limiter=limiter.metric if limiter else "",
        first_limiter_title=limiter.metric_title if limiter else "",
        reason=reason or "ни одна ступень не вышла за пороги — потолок выше протестированного",
    )


# ————————————————————————— общее —————————————————————————


def _dedupe(findings: list[Finding], ctx: DetectorContext) -> list[Finding]:
    """Одна метрика — одна находка на фазу. Дрейф информативнее сдвига уровня.

    Инварианты не участвуют: нарушение SLO надо показать, даже если рядом
    статистика нашла ту же деградацию другими словами.
    """
    best: dict[tuple, Finding] = {}
    kept: list[Finding] = []
    for finding in findings:
        if finding.detector in (DetectorKind.INVARIANT, DetectorKind.EVENT):
            kept.append(finding)
            continue
        slot = (finding.metric, finding.phase)
        current = best.get(slot)
        if current is None:
            best[slot] = finding
            continue
        winner, loser = (
            (finding, current) if finding.detector == DetectorKind.DRIFT else (current, finding)
        )
        best[slot] = winner
        ctx.suppressed.append(
            f"{loser.metric_title}: «{loser.title}» поглощена находкой «{winner.title}»"
        )

    statistical = _drop_raw_twins(list(best.values()), ctx)
    kept.extend(_drop_rule_twins(statistical, kept, ctx))
    kept.sort(key=lambda f: (SEVERITY_ORDER[f.severity], f.from_ts))
    limit = int(ctx.cfg.get("max_findings", 24))
    if len(kept) > limit:
        ctx.suppressed.append(
            f"Ещё {len(kept) - limit} находок ниже по важности скрыто, чтобы отчёт оставался читаемым"
        )
    return kept[:limit]


def _drop_raw_twins(findings: list[Finding], ctx: DetectorContext) -> list[Finding]:
    """«CPU 1,8 ядра» и «CPU 92% от лимита» — одна новость, сказанная дважды.

    Оставляем ту, что в процентах от лимита: читателю важно расстояние до потолка,
    а не абсолютное значение, для которого он не помнит лимит наизусть.
    """
    twins = {
        spec.numerator: spec.key
        for spec in CATALOG.derived.values()
        if spec.formula == "ratio_pct"
    }
    saturated = {(f.metric, f.phase, f.detector) for f in findings}
    out: list[Finding] = []
    for finding in findings:
        twin = twins.get(finding.metric)
        if twin and (twin, finding.phase, finding.detector) in saturated:
            ctx.suppressed.append(
                f"{finding.metric_title}: то же самое показано как «{CATALOG.title(twin)}»"
            )
            continue
        out.append(finding)
    return out


def _drop_rule_twins(
    statistical: list[Finding], rules: list[Finding], ctx: DetectorContext
) -> list[Finding]:
    """Нарушенное правило важнее статистики по той же метрике в том же окне.

    «p99 вышел за SLO» и «p99 растёт» — одна и та же новость, но первая говорит,
    что делать, а вторая только описывает форму кривой.
    """
    out: list[Finding] = []
    for finding in statistical:
        twin = next(
            (
                r
                for r in rules
                if r.metric == finding.metric
                and r.from_ts <= finding.to_ts
                and finding.from_ts <= r.to_ts
            ),
            None,
        )
        if twin is not None:
            ctx.suppressed.append(
                f"{finding.metric_title}: «{finding.title}» перекрыта правилом «{twin.title}»"
            )
            continue
        out.append(finding)
    return out


def _finding(
    ctx: DetectorContext,
    *,
    detector: DetectorKind,
    key: str,
    phase: Phase | None,
    from_ts: int,
    to_ts: int,
    severity: Severity,
    title: str,
    summary: str,
    next_step: str,
    evidence: Evidence,
    chunk: Series,
    baseline: float | None = None,
    limit: float | None = None,
    confidence: int = 80,
    direction: str = "up",
    rule_id: str = "",
    rule_class: str = "",
) -> Finding:
    spark_t, spark_v = stats.downsample(chunk.t, chunk.v, SPARK_POINTS)
    labels = {"direction": direction}
    if rule_id:
        labels["rule"] = rule_id
    if rule_class:
        labels["class"] = rule_class
    return Finding(
        id=f"{detector.value}-{key.replace('.', '_')}-{from_ts}",
        detector=detector,
        severity=severity,
        metric=key,
        metric_title=CATALOG.title(key),
        unit=chunk.unit,
        phase=phase.kind if phase else None,
        from_ts=_dt(from_ts),
        to_ts=_dt(to_ts),
        title=title,
        summary=summary,
        next_step=next_step,
        evidence=evidence,
        spark=Spark(t=spark_t, v=spark_v, unit=chunk.unit, baseline=baseline, limit=limit),
        confidence=confidence,
        query=ctx.queries.get(key, ""),
        labels=labels,
    )


def _phases(ctx: DetectorContext, kinds: tuple[PhaseKind, ...]) -> list[Phase]:
    return [p for p in ctx.phases if not p.excluded and p.kind in kinds]


def _level_next_step(key: str, up: bool) -> str:
    group = CATALOG.group(key)
    if group in ("jvm", "go"):
        return "Сопоставьте момент сдвига с релизом, прогревом кэша или фоновой задачей — ступенька обычно имеет событие-причину."
    if group == "http":
        return "Разложите метрику по эндпоинтам: ступенька в общем ряду почти всегда объясняется одним-двумя URL."
    if not up:
        return "Провал показателя чаще означает, что часть трафика перестала доходить, а не что стало лучше."
    return "Найдите событие в этот момент: деплой соседа, старт фоновой обработки, смена профиля данных."


# Метрики рантайма, которые растут не от памяти: советовать по ним heap dump — сбивать с
# толку. Группы `jvm`/`go` слишком грубые, чтобы различать это по ним.
_RUNTIME_QUEUE_KEYS = (
    "jvm.pool.",
    "jvm.threads.",
    "go.goroutines",
    "go.threads",
    "derived.thread_saturation",
)


def _drift_next_step(key: str, up: bool) -> str:
    if key.startswith(_RUNTIME_QUEUE_KEYS):
        return (
            "Растёт занятость исполнителей, а не память: ищите, что стало дольше выполняться — "
            "внешний вызов без таймаута, блокировка на общем ресурсе или очередь к БД."
        )
    match CATALOG.group(key):
        case "jvm" | "go":
            return "Снимите дамп памяти в начале и в конце плато и сравните: монотонный рост между двумя точками указывает на удерживаемые объекты."
        case "db":
            return "Сравните с объёмом данных: за длинный тест таблицы растут, и план запроса может смениться на середине прогона."
        case "http":
            return "Проверьте, растёт ли вместе с этим потребление ресурсов. Если нет — деградация пришла снаружи сервиса."
        case _:
            return "Продлите наблюдение: дрейф на часовом плато к восьмичасовому тесту превращается в отказ."


def _epoch(value: datetime) -> int:
    return int(value.timestamp())


def _dt(ts: int) -> datetime:
    return datetime.fromtimestamp(int(ts), UTC)
