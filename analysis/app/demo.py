"""Синтетический источник метрик.

Нужен для двух вещей: показать модуль без доступа к VictoriaMetrics и прогонять
детекторы по рядам с заранее известным дефектом — это регрессионный тест на
чувствительность и на ложные срабатывания одновременно.

Данные синтетические, конвейер настоящий: фазы, детекторы, корреляция и гипотезы
работают ровно тем же кодом, что и на живом источнике.
"""
from __future__ import annotations

import hashlib

import numpy as np

from .catalog import CATALOG
from .models import LoadProfile, TestKind
from .series import Series

FAULTS = ("leak", "pool", "throttle", "clean")


def pick_fault(run_id: str) -> str:
    if not run_id:
        return "leak"
    digest = hashlib.sha256(run_id.encode()).digest()
    return FAULTS[digest[0] % len(FAULTS)]


def generate(
    profile: LoadProfile,
    runtime: str,
    start: int,
    end: int,
    step: int,
    fault: str,
    seed: str,
) -> dict[str, Series]:
    rng = np.random.default_rng(int.from_bytes(hashlib.sha256(seed.encode()).digest()[:8], "big"))
    t = np.arange(start, end + 1, step, dtype=np.int64)
    rps, hold = _load_curve(t, profile)
    target_rps = float(np.max(rps)) or 1.0

    out: dict[str, Series] = {}
    for spec in CATALOG.for_runtime(runtime):
        demo = spec.demo
        if not demo:
            continue
        kind = demo.get("kind", "gauge")
        if kind == "rps":
            values = rps.copy()
        elif kind == "static":
            values = np.full(t.size, float(demo.get("base", 0.0)))
        elif kind == "counter":
            values = np.full(t.size, float(demo.get("base", 0.0)))
        else:
            base = float(demo.get("base", 1.0))
            gain = float(demo.get("follow_gain", 0.0)) if demo.get("follows") == "rps" else 0.0
            shape = 1.0 + gain * (rps / target_rps - 1.0)
            noise = rng.normal(0.0, base * float(demo.get("noise_pct", 0.0)) / 100.0, t.size)
            values = np.clip(base * shape + noise, 0.0, None)
        out[spec.key] = Series(spec.key, spec.title, spec.unit, spec.group, t, values)

    _warmup_transient(out, t, start)
    _network_blip(out, t, hold, rng)
    _apply_fault(out, t, hold, fault, rng)
    return out


def _load_curve(t: np.ndarray, profile: LoadProfile) -> tuple[np.ndarray, np.ndarray]:
    """Профиль нагрузки и маска плато/ступеней — на них накладываются дефекты."""
    rel = (t - t[0]).astype(float)
    total = float(rel[-1]) if rel.size else 1.0
    target = profile.target_rps or 800.0

    if profile.test_kind == TestKind.MAX_SEARCH:
        steps = max(profile.steps or 6, 2)
        step_len = total / steps
        level = np.minimum((rel // max(step_len, 1)).astype(int) + 1, steps)
        rps = target * level / steps
        return rps, rel > step_len * 0.5

    ramp = float(profile.ramp_up_sec or 300)
    cooldown = 120.0
    hold_end = max(total - cooldown, ramp)
    rps = np.where(
        rel < ramp,
        target * np.clip(rel / max(ramp, 1.0), 0.0, 1.0),
        np.where(rel <= hold_end, target, target * 0.05),
    )
    return rps, (rel >= ramp) & (rel <= hold_end)


def _warmup_transient(series: dict[str, Series], t: np.ndarray, start: int) -> None:
    """Прогрев: JIT ещё не разогрет, кэши пусты. Детектор обязан это проигнорировать."""
    mask = (t - start) < 90
    for key, factor in (("http.rt.p99", 3.2), ("http.rt.p90", 2.4), ("cpu.usage", 1.5)):
        s = series.get(key)
        if s is not None:
            s.v[mask] *= factor


def _network_blip(series: dict[str, Series], t: np.ndarray, hold: np.ndarray, rng) -> None:
    """Одиночный сетевой всплеск на две точки — проверка фильтра персистентности."""
    idx = np.flatnonzero(hold)
    if idx.size < 20:
        return
    at = int(idx[idx.size // 3])
    for key, factor in (("http.rt.p99", 4.0), ("http.rt.p90", 2.5), ("http.error_rate", 12.0)):
        s = series.get(key)
        if s is not None:
            s.v[at : at + 2] *= factor


def _apply_fault(series: dict[str, Series], t: np.ndarray, hold: np.ndarray, fault: str, rng) -> None:
    idx = np.flatnonzero(hold)
    if idx.size == 0:
        return
    # Прогресс дефекта от 0 в начале плато до 1 в конце — линейный рост.
    ramp = np.zeros(t.size)
    ramp[idx] = np.linspace(0.0, 1.0, idx.size)
    late = np.zeros(t.size)
    half = idx[idx.size // 2 :]
    late[half] = np.linspace(0.0, 1.0, half.size)

    match fault:
        case "leak":
            _scale(series, "jvm.gc.live_data", 1.0 + 0.95 * ramp)
            _scale(series, "jvm.heap.used", 1.0 + 0.35 * ramp)
            _scale(series, "mem.working_set", 1.0 + 0.55 * ramp)
            _scale(series, "jvm.gc.pause_share", 1.0 + 7.0 * ramp**2)
            _scale(series, "jvm.gc.pause_max", 1.0 + 5.0 * ramp**2)
            _scale(series, "go.heap.inuse", 1.0 + 0.8 * ramp)
            _scale(series, "go.goroutines", 1.0 + 1.4 * ramp)
            _scale(series, "go.gc.pause_share", 1.0 + 6.0 * ramp**2)
            _scale(series, "http.rt.p99", 1.0 + 1.6 * late**2)
        case "pool":
            # Занятых соединений не бывает больше, чем есть в пуле: сверх размера
            # потоки уходят в очередь, а не открывают ещё одно соединение.
            _scale(series, "db.pool.active", 1.0 + 2.6 * late)
            _cap(series, "db.pool.active", "db.pool.max")
            _add(series, "db.pool.pending", 9.0 * late)
            _scale(series, "db.pool.acquire_p99", 1.0 + 40.0 * late)
            _scale(series, "db.query.p99", 1.0 + 0.4 * late)
            _scale(series, "http.rt.p99", 1.0 + 5.0 * late)
            _scale(series, "jvm.pool.busy", 1.0 + 3.2 * late)
            _add(series, "http.error_rate", 2.4 * late**2)
        case "throttle":
            _scale(series, "cpu.usage", 1.0 + 1.1 * ramp)
            _add(series, "cpu.throttled", 26.0 * late)
            _scale(series, "http.rt.p99", 1.0 + 2.2 * late)
            _scale(series, "http.rt.p90", 1.0 + 0.6 * late)
        case _:
            return


def _scale(series: dict[str, Series], key: str, factor: np.ndarray) -> None:
    s = series.get(key)
    if s is not None:
        s.v = s.v * factor


def _add(series: dict[str, Series], key: str, delta: np.ndarray) -> None:
    s = series.get(key)
    if s is not None:
        s.v = np.clip(s.v + delta, 0.0, None)


def _cap(series: dict[str, Series], key: str, limit_key: str) -> None:
    s, limit = series.get(key), series.get(limit_key)
    if s is not None and limit is not None:
        s.v = np.minimum(s.v, limit.v)
