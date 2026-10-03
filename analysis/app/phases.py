"""Разметка фаз теста.

Без фаз анализ бессмысленен: рост CPU на разгоне — это работа профиля нагрузки,
тот же рост на плато — находка. Поэтому сначала мы отвечаем на вопрос «что здесь
происходило», и только потом ищем аномалии внутри однородных участков.

Приоритет у факта, а не у заявленного профиля: сценарий мог не доехать до
целевого RPS, упереться в autostop или стартовать с задержкой.
"""
from __future__ import annotations

from datetime import UTC, datetime

import numpy as np

from .models import LoadProfile, Phase, PhaseKind, TestKind
from .series import Series

MIN_PHASE_SEC = 120
# Ниже этой доли от пика считаем, что нагрузки нет.
IDLE_FRACTION = 0.12
# Рост быстрее этой доли пика в минуту — разгон, а не дрейф плато.
RAMP_PER_MIN = 0.06


def detect(
    rps: Series | None,
    profile: LoadProfile,
    start: int,
    end: int,
    warmup_skip_sec: int,
    cooldown_skip_sec: int,
) -> list[Phase]:
    phases = (
        _from_series(rps, profile, start, end)
        if rps is not None and rps.t.size >= 8
        else _from_profile(profile, start, end)
    )
    return _mark_edges(phases, start, end, warmup_skip_sec, cooldown_skip_sec)


def analysable(phases: list[Phase], kinds: tuple[PhaseKind, ...]) -> list[Phase]:
    return [p for p in phases if not p.excluded and p.kind in kinds]


def phase_at(phases: list[Phase], ts: int) -> Phase | None:
    moment = datetime.fromtimestamp(ts, UTC)
    for phase in phases:
        if phase.from_ts <= moment <= phase.to_ts:
            return phase
    return None


def _from_series(rps: Series, profile: LoadProfile, start: int, end: int) -> list[Phase]:
    level = _smooth(rps.v, 5)
    peak = float(np.percentile(level, 95)) or 1.0
    slope = _slope_per_min(rps.t, level)

    kinds: list[PhaseKind] = []
    for value, rate in zip(level, slope):
        if value < peak * IDLE_FRACTION:
            kinds.append(PhaseKind.IDLE)
        elif abs(rate) > peak * RAMP_PER_MIN:
            kinds.append(PhaseKind.RAMP if rate > 0 else PhaseKind.COOLDOWN)
        else:
            kinds.append(PhaseKind.PLATEAU)

    segments = _segments(rps.t, kinds, level)
    for seg in segments:
        # Страховка: участок с нагрузкой ниже порога — простой, чем бы его ни
        # посчитала классификация по наклону. Иначе хвост после остановки
        # генератора попадёт в плато и любой ряд «просядет» на его границе.
        if seg["rps"] < peak * IDLE_FRACTION:
            seg["kind"] = PhaseKind.IDLE

    stepwise = profile.test_kind == TestKind.MAX_SEARCH or _looks_stepwise(segments, peak)
    if stepwise:
        for seg in segments:
            if seg["kind"] == PhaseKind.PLATEAU:
                seg["kind"] = PhaseKind.STEP

    phases: list[Phase] = []
    step_no = 0
    for seg in segments:
        kind = seg["kind"]
        if kind == PhaseKind.STEP:
            step_no += 1
        phases.append(
            Phase(
                kind=kind,
                from_ts=_dt(seg["from"]),
                to_ts=_dt(seg["to"]),
                rps=round(seg["rps"], 1),
                label=_label(kind, seg["rps"], step_no),
            )
        )
    return phases or _from_profile(profile, start, end)


def _from_profile(profile: LoadProfile, start: int, end: int) -> list[Phase]:
    """Фолбэк, когда ряда RPS нет: разметка по заявленному сценарию."""
    total = max(end - start, 1)
    if profile.test_kind == TestKind.MAX_SEARCH and profile.steps > 1:
        count = profile.steps
        step_len = (profile.step_duration_sec or total // count) or 1
        phases: list[Phase] = []
        cursor = start
        for i in range(count):
            stop = min(cursor + step_len, end)
            if stop <= cursor:
                break
            rps = profile.target_rps * (i + 1) / count
            phases.append(
                Phase(
                    kind=PhaseKind.STEP,
                    from_ts=_dt(cursor),
                    to_ts=_dt(stop),
                    rps=round(rps, 1),
                    label=_label(PhaseKind.STEP, rps, i + 1),
                )
            )
            cursor = stop
        return phases

    ramp = min(profile.ramp_up_sec or 0, total)
    phases = []
    if ramp > 0:
        phases.append(
            Phase(
                kind=PhaseKind.RAMP,
                from_ts=_dt(start),
                to_ts=_dt(start + ramp),
                rps=profile.target_rps / 2,
                label=_label(PhaseKind.RAMP, profile.target_rps / 2, 0),
            )
        )
    phases.append(
        Phase(
            kind=PhaseKind.PLATEAU,
            from_ts=_dt(start + ramp),
            to_ts=_dt(end),
            rps=profile.target_rps,
            label=_label(PhaseKind.PLATEAU, profile.target_rps, 0),
        )
    )
    return phases


def _mark_edges(
    phases: list[Phase], start: int, end: int, warmup_skip_sec: int, cooldown_skip_sec: int
) -> list[Phase]:
    """Прогрев и хвост после нагрузки исключаем из детектирования, но показываем в UI."""
    warmup_until = _dt(start + warmup_skip_sec)
    cooldown_from = _dt(end - cooldown_skip_sec)
    result: list[Phase] = []
    for phase in phases:
        if phase.kind in (PhaseKind.IDLE, PhaseKind.COOLDOWN):
            phase.excluded = True
        elif phase.to_ts <= warmup_until:
            phase.kind = PhaseKind.WARMUP
            phase.label = "Прогрев"
            phase.excluded = True
        elif phase.from_ts < warmup_until < phase.to_ts:
            head = Phase(
                kind=PhaseKind.WARMUP,
                from_ts=phase.from_ts,
                to_ts=warmup_until,
                rps=phase.rps,
                label="Прогрев",
                excluded=True,
            )
            phase.from_ts = warmup_until
            result.append(head)
        if phase.from_ts >= cooldown_from:
            phase.excluded = True
        if phase.to_ts > phase.from_ts:
            result.append(phase)
    return result


def _segments(t: np.ndarray, kinds: list[PhaseKind], level: np.ndarray) -> list[dict]:
    """Склейка соседних точек одного вида и поглощение слишком коротких участков.

    Короткое плато или разгон растворяются в соседнем участке под нагрузкой —
    это дрожание классификатора. Простой и снижение не поглощаются никогда:
    приклеив хвост после остановки генератора к плато, мы получили бы обрыв
    внутри «однородной» фазы и лавину ложных находок на нём.
    """
    raw: list[dict] = []
    for i, kind in enumerate(kinds):
        if raw and raw[-1]["kind"] == kind:
            raw[-1]["to"] = int(t[i])
            raw[-1]["idx"].append(i)
        else:
            raw.append({"kind": kind, "from": int(t[i]), "to": int(t[i]), "idx": [i]})

    under_load = (PhaseKind.RAMP, PhaseKind.PLATEAU)
    merged: list[dict] = []
    for seg in raw:
        short = seg["to"] - seg["from"] < MIN_PHASE_SEC
        absorbable = seg["kind"] in under_load and merged and merged[-1]["kind"] in under_load
        if short and absorbable:
            merged[-1]["to"] = seg["to"]
            merged[-1]["idx"].extend(seg["idx"])
        else:
            merged.append(seg)
    for seg in merged:
        seg["rps"] = float(np.median(level[seg["idx"]]))
    return merged


def _looks_stepwise(segments: list[dict], peak: float) -> bool:
    """Три и более плато на заметно разных уровнях — это ступенчатый поиск максимума."""
    levels = [s["rps"] for s in segments if s["kind"] == PhaseKind.PLATEAU]
    if len(levels) < 3:
        return False
    spread = max(levels) - min(levels)
    return spread > peak * 0.25


def _smooth(values: np.ndarray, window: int) -> np.ndarray:
    if values.size < window or window < 2:
        return values.astype(float)
    kernel = np.ones(window) / window
    return np.convolve(values, kernel, mode="same")


def _slope_per_min(t: np.ndarray, values: np.ndarray) -> np.ndarray:
    """Центральная разность через ±w точек — устойчивее поточечной производной."""
    n = values.size
    w = max(1, min(3, n // 4))
    out = np.zeros(n)
    for i in range(n):
        a, b = max(0, i - w), min(n - 1, i + w)
        dt = float(t[b] - t[a])
        if dt > 0:
            out[i] = (values[b] - values[a]) / dt * 60.0
    return out


def _label(kind: PhaseKind, rps: float, step_no: int) -> str:
    match kind:
        case PhaseKind.RAMP:
            return "Разгон"
        case PhaseKind.PLATEAU:
            return f"Плато · {rps:.0f} RPS"
        case PhaseKind.STEP:
            return f"Ступень {step_no} · {rps:.0f} RPS"
        case PhaseKind.COOLDOWN:
            return "Снижение"
        case PhaseKind.WARMUP:
            return "Прогрев"
        case _:
            return "Простой"


def _dt(ts: int) -> datetime:
    return datetime.fromtimestamp(int(ts), UTC)
