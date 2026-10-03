"""Временной ряд и операции над ним.

Один класс на весь конвейер: коллектор его наполняет, детекторы читают.
Значения храним в numpy — детекторы работают векторно, а рядов на прогон
до сорока штук по несколько тысяч точек.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class Series:
    key: str
    title: str
    unit: str
    group: str
    t: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=np.int64))
    v: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=float))
    status: str = "ok"

    @property
    def empty(self) -> bool:
        return self.t.size == 0

    def window(self, from_ts: int, to_ts: int) -> Series:
        if self.empty:
            return self
        mask = (self.t >= from_ts) & (self.t <= to_ts)
        return Series(self.key, self.title, self.unit, self.group, self.t[mask], self.v[mask], self.status)

    def step_sec(self) -> float:
        """Медианный шаг сетки. Нужен, чтобы пересчитать «держалось N точек» в секунды."""
        if self.t.size < 2:
            return 0.0
        return float(np.median(np.diff(self.t)))

    def median(self) -> float:
        return float(np.median(self.v)) if self.v.size else 0.0

    def last(self) -> float:
        return float(self.v[-1]) if self.v.size else 0.0

    def first(self) -> float:
        return float(self.v[0]) if self.v.size else 0.0

    def maximum(self) -> float:
        return float(np.max(self.v)) if self.v.size else 0.0


def from_samples(
    key: str, title: str, unit: str, group: str, samples: list[tuple[float, float]]
) -> Series:
    """Точки из VictoriaMetrics: NaN на разрывах scrape выкидываем сразу."""
    if not samples:
        return Series(key, title, unit, group, status="empty")
    t = np.fromiter((int(ts) for ts, _ in samples), dtype=np.int64, count=len(samples))
    v = np.fromiter((val for _, val in samples), dtype=float, count=len(samples))
    keep = np.isfinite(v)
    if not keep.any():
        return Series(key, title, unit, group, status="empty")
    return Series(key, title, unit, group, t[keep], v[keep])


def ratio(
    key: str,
    title: str,
    unit: str,
    group: str,
    numerator: Series,
    denominator: Series,
    scale: float = 1.0,
) -> Series:
    """Отношение двух рядов на общей сетке времени.

    Знаменатель интерполируем по ступенькам (последнее известное значение):
    лимиты и размеры пулов приходят редко, линейная интерполяция нарисовала бы
    несуществующий плавный рост между двумя скрейпами.
    """
    if numerator.empty or denominator.empty:
        return Series(key, title, unit, group, status="empty")
    idx = np.searchsorted(denominator.t, numerator.t, side="right") - 1
    idx = np.clip(idx, 0, denominator.t.size - 1)
    den = denominator.v[idx]
    with np.errstate(divide="ignore", invalid="ignore"):
        values = np.where(np.abs(den) > 1e-9, numerator.v / den * scale, np.nan)
    keep = np.isfinite(values)
    if not keep.any():
        return Series(key, title, unit, group, status="empty")
    return Series(key, title, unit, group, numerator.t[keep], values[keep])
