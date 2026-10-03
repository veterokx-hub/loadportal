"""Конвейер анализа: от цели и окна до готового отчёта.

Порядок шагов не случаен:
  1. окно и цель — без них нечего спрашивать;
  2. первый проход крупным шагом по всему каталогу — дёшево и даёт общую картину;
  3. фазы — контекст, без которого любая находка бессмысленна;
  4. детекторы;
  5. второй проход мелким шагом по окнам находок — уточняет и отсеивает то,
     что на грубой сетке выглядело устойчивым, а на мелкой оказалось всплеском;
  6. корреляция, гипотезы, вердикт.

Второй проход намеренно ограничен окнами находок: полная выгрузка 24-часового
теста с шагом 15 секунд — это миллионы точек и уложенный vmselect ради данных,
которые никто не посмотрит.
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import UTC, datetime, timedelta

from . import correlate, demo, detectors, hypotheses, phases, stats
from .catalog import CATALOG
from .models import (
    AnalysisReport,
    AnalysisTarget,
    AnalyzeRequest,
    Coverage,
    Cost,
    DetectorKind,
    Finding,
    LoadProfile,
    MetricCoverage,
    PhaseKind,
    Runtime,
    Severity,
    SEVERITY_ORDER,
    Spark,
    Validity,
    Verdict,
)
from .series import Series, from_samples, ratio
from .vm import Budget, VictoriaMetricsClient, choose_step, MIN_STEP_SEC

log = logging.getLogger(__name__)

DEFAULT_WINDOW = timedelta(hours=1, minutes=10)
MAX_WINDOW = timedelta(hours=30)
# Мелкий проход: сколько окна добираем слева и справа от находки.
REFINE_PAD_RATIO = 0.15
REFINE_MAX_FINDINGS = 12


async def analyze(req: AnalyzeRequest, vm: VictoriaMetricsClient | None) -> AnalysisReport:
    started = time.perf_counter()
    window_from, window_to = _window(req)
    start, end = int(window_from.timestamp()), int(window_to.timestamp())
    step = choose_step(end - start)
    budget = Budget(step_sec=step)

    target = req.target
    use_demo = req.demo or vm is None or not vm.configured
    fault = req.demo_fault or demo.pick_fault(req.run_id or req.test_id)

    if use_demo:
        series = demo.generate(
            req.profile, _demo_runtime(target), start, end, step, fault, req.run_id or "demo"
        )
        queries = {key: "demo://synthetic" for key in series}
    else:
        series, queries = await _collect(vm, target, start, end, step, budget)

    runtime = _detect_runtime(target, series)
    series = {k: s for k, s in series.items() if _runtime_ok(k, runtime)}
    _add_derived(series, runtime)

    marks = phases.detect(
        series.get("http.rps"),
        req.profile,
        start,
        end,
        int(CATALOG.detectors.get("warmup_skip_sec", 120)),
        int(CATALOG.detectors.get("cooldown_skip_sec", 60)),
    )

    ctx = detectors.DetectorContext(series=series, queries=queries, phases=marks, profile=req.profile)
    findings = detectors.run_all(ctx)
    if not use_demo:
        findings = await _refine(vm, target, findings, ctx, budget)

    links = correlate.build(findings)
    guesses = hypotheses.enrich(hypotheses.build(findings, links))
    capacity = detectors.capacity(ctx, findings)
    coverage = _coverage(series, runtime)
    validity = _validity(findings)
    verdict, score = _verdict(findings, coverage)

    budget.duration_ms = int((time.perf_counter() - started) * 1000)
    return AnalysisReport(
        run_id=req.run_id,
        test_id=req.test_id,
        ruleset_version=CATALOG.ruleset_version,
        generated_at=datetime.now(UTC),
        window_from=window_from,
        window_to=window_to,
        target=AnalysisTarget(**{**target.model_dump(), "runtime": runtime}),
        test_kind=req.profile.test_kind,
        verdict=verdict,
        headline=_headline(verdict, findings, links, guesses, coverage, validity),
        health_score=score,
        validity=validity,
        phases=marks,
        findings=findings,
        correlations=links,
        hypotheses=guesses,
        capacity=capacity,
        coverage=coverage,
        cost=Cost(
            queries=budget.queries,
            points_fetched=budget.points,
            duration_ms=budget.duration_ms,
            step_sec=budget.step_sec,
            refined_metrics=budget.refined,
            degraded=budget.degraded,
            degraded_reason=budget.degraded_reason,
        ),
        suppressed=ctx.suppressed,
        demo=use_demo,
        demo_fault=fault if use_demo else "",
    )


# ————————————————————————— сбор данных —————————————————————————


async def _collect(
    vm: VictoriaMetricsClient,
    target: AnalysisTarget,
    start: int,
    end: int,
    step: int,
    budget: Budget,
) -> tuple[dict[str, Series], dict[str, str]]:
    specs = CATALOG.for_runtime(target.runtime.value)
    payload = target.model_dump()
    queries = {spec.key: CATALOG.render(spec, payload, step) for spec in specs}

    results = await asyncio.gather(
        *(vm.query_range(queries[spec.key], start, end, step, budget) for spec in specs),
        return_exceptions=True,
    )

    series: dict[str, Series] = {}
    for spec, samples in zip(specs, results):
        if isinstance(samples, BaseException):
            log.warning("Метрика %s не загружена: %s", spec.key, samples)
            series[spec.key] = Series(spec.key, spec.title, spec.unit, spec.group, status="error")
            continue
        series[spec.key] = from_samples(spec.key, spec.title, spec.unit, spec.group, samples)
    return series, queries


async def _refine(
    vm: VictoriaMetricsClient,
    target: AnalysisTarget,
    findings: list[Finding],
    ctx: detectors.DetectorContext,
    budget: Budget,
) -> list[Finding]:
    """Перепроверка находок на мелкой сетке.

    Дрейф не уточняем: он про часы, а не про секунды. Уровень и инварианты —
    уточняем, и если на мелком шаге нарушение оказалось короче требуемого,
    находка снимается: именно так отсеивается транзиентный всплеск, размазанный
    крупным шагом в «устойчивое» отклонение.
    """
    candidates = [
        f for f in findings if f.detector in (DetectorKind.LEVEL, DetectorKind.INVARIANT)
    ][:REFINE_MAX_FINDINGS]
    if not candidates:
        return findings

    payload = target.model_dump()
    jobs = []
    for finding in candidates:
        spec = CATALOG.metrics.get(finding.metric)
        if spec is None:
            jobs.append(None)
            continue
        span = max(int(finding.to_ts.timestamp() - finding.from_ts.timestamp()), MIN_STEP_SEC)
        pad = int(span * REFINE_PAD_RATIO) + MIN_STEP_SEC
        lo = int(finding.from_ts.timestamp()) - pad
        hi = int(finding.to_ts.timestamp()) + pad
        step = choose_step(hi - lo, max_points=240)
        jobs.append((finding, spec, lo, hi, step))

    fetched = await asyncio.gather(
        *(
            vm.query_range(CATALOG.render(job[1], payload, job[4]), job[2], job[3], job[4], budget)
            for job in jobs
            if job
        ),
        return_exceptions=True,
    )

    persistence = float(CATALOG.detectors.get("level", {}).get("persistence_sec", 90))
    dropped: set[str] = set()
    it = iter(fetched)
    for job in jobs:
        if not job:
            continue
        finding, spec, lo, hi, step = job
        samples = next(it)
        if isinstance(samples, BaseException) or not samples:
            continue
        budget.refined += 1
        fine = from_samples(spec.key, spec.title, spec.unit, spec.group, samples)
        if fine.empty:
            continue

        if finding.detector == DetectorKind.LEVEL and _too_short(finding, fine, persistence):
            dropped.add(finding.id)
            ctx.suppressed.append(
                f"{finding.metric_title}: на мелком шаге отклонение продержалось меньше "
                f"{int(persistence)} с — это всплеск, а не сдвиг уровня"
            )
            continue

        spark_t, spark_v = stats.downsample(fine.t, fine.v, 48)
        finding.spark = Spark(
            t=spark_t,
            v=spark_v,
            unit=finding.unit,
            baseline=finding.spark.baseline,
            limit=finding.spark.limit,
        )
    return [f for f in findings if f.id not in dropped]


def _too_short(finding: Finding, fine: Series, persistence: float) -> bool:
    baseline = finding.evidence.baseline
    observed = finding.evidence.observed
    if baseline is None or observed is None:
        return False
    threshold = (baseline + observed) / 2.0
    mask = fine.v > threshold if observed > baseline else fine.v < threshold
    run_len, _, _ = stats.longest_true_run(mask)
    return run_len * (fine.step_sec() or 1.0) < persistence


def _add_derived(series: dict[str, Series], runtime: str) -> None:
    for spec in CATALOG.derived.values():
        if not _runtime_ok(spec.key, runtime, spec.runtime):
            continue
        num, den = series.get(spec.numerator), series.get(spec.denominator)
        if num is None or den is None or num.empty or den.empty:
            continue
        scale = 100.0 if spec.formula == "ratio_pct" else 1.0
        series[spec.key] = ratio(spec.key, spec.title, spec.unit, spec.group, num, den, scale)


# ————————————————————————— сводка —————————————————————————


def _coverage(series: dict[str, Series], runtime: str) -> Coverage:
    items: list[MetricCoverage] = []
    weight_total = weight_ok = 0
    groups_ok: set[str] = set()
    groups_missing: set[str] = set()

    for key, s in series.items():
        if key.startswith("derived."):
            continue
        weight = CATALOG.importance(key)
        status = "error" if s.status == "error" else ("ok" if not s.empty else "empty")
        weight_total += weight
        if status == "ok":
            weight_ok += weight
            groups_ok.add(s.group)
        else:
            groups_missing.add(s.group)
        items.append(
            MetricCoverage(
                key=key, title=s.title, group=s.group, status=status, points=int(s.t.size)
            )
        )

    items.sort(key=lambda m: (m.group, m.title))
    available = sum(1 for m in items if m.status == "ok")
    return Coverage(
        requested=len(items),
        available=available,
        groups_ok=sorted(groups_ok),
        groups_missing=sorted(groups_missing - groups_ok),
        metrics=items,
        score=int(weight_ok / weight_total * 100) if weight_total else 0,
    )


def _validity(findings: list[Finding]) -> Validity:
    reasons = [
        f.title
        for f in findings
        if f.labels.get("rule") in ("restarts_during_test", "oom_killed", "pods_lost")
    ]
    return Validity(valid=not reasons, reasons=reasons)


def _verdict(findings: list[Finding], coverage: Coverage) -> tuple[Verdict, int]:
    counts = {level: 0 for level in Severity}
    for finding in findings:
        counts[finding.severity] += 1
    # Вклад каждого уровня ограничен: пять следствий одной причины не должны
    # обнулять оценку сильнее, чем сама причина. Иначе шкала перестаёт различать
    # «одна серьёзная проблема» и «всё развалилось».
    score = (
        100
        - 25 * min(counts[Severity.CRITICAL], 2)
        - 8 * min(counts[Severity.MAJOR], 4)
        - 2 * min(counts[Severity.MINOR], 5)
    )
    score = max(0, min(100, score))

    if counts[Severity.CRITICAL]:
        return Verdict.UNHEALTHY, score
    if counts[Severity.MAJOR]:
        return Verdict.DEGRADED, score
    if coverage.score < 40:
        return Verdict.INCONCLUSIVE, score
    return Verdict.HEALTHY, score


def _headline(
    verdict: Verdict,
    findings: list[Finding],
    links: list,
    guesses: list,
    coverage: Coverage,
    validity: Validity,
) -> str:
    if not validity.valid:
        # Строчной делается только первая буква: lower() на всей строке съедает
        # аббревиатуры вроде «БД» и «GC» в названиях находок.
        reasons = "; ".join(r[:1].lower() + r[1:] for r in validity.reasons)
        return (
            f"Прогон нельзя считать чистым: {reasons}. "
            "Числа до и после этого события несопоставимы."
        )
    if verdict == Verdict.INCONCLUSIVE:
        missing = ", ".join(coverage.groups_missing[:3]) or "большая часть метрик"
        return (
            f"Данных не хватает для вывода: доступно {coverage.available} из {coverage.requested} "
            f"метрик, нет группы {missing}. Проверьте, что сервис указан верно и метрики пишутся."
        )
    if not findings:
        return (
            "Аномалий не найдено: показатели держались в пределах обычного для этого профиля "
            f"нагрузки. Проверено метрик: {coverage.available}."
        )
    top = _entry_point(findings, links)
    if guesses:
        return (
            f"{guesses[0].title.rstrip('.')}. Всего находок: {len(findings)}; "
            f"начните с «{top.title}»."
        )
    return f"Находок: {len(findings)}. Главное — «{top.title}»."


def _entry_point(findings: list[Finding], links: list) -> Finding:
    """С чего начинать разбор.

    Если находки собрались в цепочку, точка входа — её корень, а не самая
    «красная» метрика: время ответа всегда выглядит страшнее, чем причина,
    которая его испортила.
    """
    by_id = {f.id: f for f in findings}
    for corr in links:
        root = by_id.get(corr.finding_ids[0]) if corr.finding_ids else None
        if root is not None:
            return root
    return min(findings, key=lambda f: (SEVERITY_ORDER[f.severity], f.from_ts))


# ————————————————————————— вспомогательное —————————————————————————


def _window(req: AnalyzeRequest) -> tuple[datetime, datetime]:
    now = datetime.now(UTC)
    to_ts = req.window_to or now
    from_ts = req.window_from or (to_ts - DEFAULT_WINDOW)
    if to_ts - from_ts > MAX_WINDOW:
        from_ts = to_ts - MAX_WINDOW
    return from_ts, to_ts


def _detect_runtime(target: AnalysisTarget, series: dict[str, Series]) -> str:
    if target.runtime != Runtime.AUTO:
        return target.runtime.value
    jvm = any(not s.empty for k, s in series.items() if k.startswith("jvm."))
    go = any(not s.empty for k, s in series.items() if k.startswith("go."))
    if jvm and not go:
        return Runtime.JVM.value
    if go and not jvm:
        return Runtime.GO.value
    return Runtime.AUTO.value


def _runtime_ok(key: str, runtime: str, declared: str = "") -> bool:
    spec_runtime = declared or (
        CATALOG.metrics[key].runtime if key in CATALOG.metrics else "any"
    )
    return runtime in ("", Runtime.AUTO.value) or spec_runtime in ("any", runtime)


def _demo_runtime(target: AnalysisTarget) -> str:
    return target.runtime.value if target.runtime != Runtime.AUTO else Runtime.JVM.value


__all__ = ["analyze", "PhaseKind"]
