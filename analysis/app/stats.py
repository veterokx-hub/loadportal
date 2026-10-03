"""Статистика детекторов: робастный уровень, оценка тренда, значимость.

Только numpy. scipy не подключён осознанно: нужны две функции (Theil–Sen и
Mann–Kendall), обе — десяток строк, а пакет тянет ~40 МБ в образ.

Все оценки робастные (медиана/MAD, медиана попарных наклонов): выброс в 1–2
точки не должен сдвигать базовую линию, иначе транзиентный всплеск сети
маскирует настоящую деградацию рядом.
"""
from __future__ import annotations

import math

import numpy as np

# MAD → σ для нормального распределения.
MAD_TO_SIGMA = 1.4826

# Больше пар не нужно: оценка наклона по 1200 точкам уже стабильна,
# а O(n²) на длинном 24-часовом ряде съедает память.
MAX_PAIRS_POINTS = 1200


def robust_center_scale(values: np.ndarray) -> tuple[float, float]:
    """Медиана и робастная σ.

    Возвращает (center, scale). scale может быть 0 — у идеально плоского ряда;
    вызывающий обязан подмешать амплитудный порог, иначе z-оценка взорвётся.
    """
    if values.size == 0:
        return 0.0, 0.0
    center = float(np.median(values))
    mad = float(np.median(np.abs(values - center)))
    return center, mad * MAD_TO_SIGMA


def robust_z(values: np.ndarray, center: float, scale: float, floor: float) -> np.ndarray:
    """Робастная z-оценка. floor не даёт делить на почти ноль на плоских рядах."""
    denom = max(scale, floor)
    if denom <= 0:
        return np.zeros_like(values)
    return (values - center) / denom


def theil_sen(t: np.ndarray, y: np.ndarray) -> float:
    """Медиана попарных наклонов — устойчива к ~29% выбросов.

    t — секунды от начала окна, y — значения. Возвращает наклон в единицах y/сек.
    """
    n = t.size
    if n < 3:
        return 0.0
    if n > MAX_PAIRS_POINTS:
        idx = np.linspace(0, n - 1, MAX_PAIRS_POINTS).astype(int)
        t, y = t[idx], y[idx]
        n = t.size
    i, j = np.triu_indices(n, k=1)
    dt = t[j] - t[i]
    ok = dt != 0
    if not ok.any():
        return 0.0
    return float(np.median((y[j][ok] - y[i][ok]) / dt[ok]))


def mann_kendall(y: np.ndarray) -> tuple[float, float]:
    """Тест на монотонный тренд. Возвращает (tau, p_value), двусторонний.

    Нормальная аппроксимация без поправки на связки: связки уменьшают дисперсию,
    поэтому наша оценка p завышена — ошибаемся в сторону молчания, а не шума.
    """
    n = y.size
    if n < 8:
        return 0.0, 1.0
    if n > MAX_PAIRS_POINTS:
        y = y[np.linspace(0, n - 1, MAX_PAIRS_POINTS).astype(int)]
        n = y.size
    i, j = np.triu_indices(n, k=1)
    s = float(np.sum(np.sign(y[j] - y[i])))
    var = n * (n - 1) * (2 * n + 5) / 18.0
    if var <= 0:
        return 0.0, 1.0
    # Поправка на непрерывность: S дискретна, нормаль — нет.
    if s > 0:
        z = (s - 1) / math.sqrt(var)
    elif s < 0:
        z = (s + 1) / math.sqrt(var)
    else:
        z = 0.0
    p = 2.0 * (1.0 - 0.5 * (1.0 + math.erf(abs(z) / math.sqrt(2.0))))
    tau = s / (n * (n - 1) / 2.0)
    return float(tau), float(min(1.0, max(0.0, p)))


def longest_true_run(mask: np.ndarray) -> tuple[int, int, int]:
    """Самый длинный непрерывный участок True: (длина, начало, конец включительно).

    Персистентность — главный фильтр против alert fatigue: одиночный выброс
    в одной точке шага не является находкой ни при каком z.
    """
    if mask.size == 0 or not mask.any():
        return 0, -1, -1
    best_len = best_start = 0
    cur_len = 0
    cur_start = 0
    for k, flag in enumerate(mask):
        if flag:
            if cur_len == 0:
                cur_start = k
            cur_len += 1
            if cur_len > best_len:
                best_len, best_start = cur_len, cur_start
        else:
            cur_len = 0
    return best_len, best_start, best_start + best_len - 1


def downsample(t: np.ndarray, y: np.ndarray, points: int) -> tuple[list[int], list[float]]:
    """Прореживание для спарклайна. Берём максимум в корзине — пики не теряются."""
    n = t.size
    if n == 0:
        return [], []
    if n <= points:
        return [int(x) for x in t], [_finite(v) for v in y]
    edges = np.linspace(0, n, points + 1).astype(int)
    ts: list[int] = []
    vs: list[float] = []
    for a, b in zip(edges[:-1], edges[1:]):
        if b <= a:
            continue
        chunk = y[a:b]
        k = int(np.argmax(np.abs(chunk - np.median(chunk)))) if chunk.size > 1 else 0
        ts.append(int(t[a + k]))
        vs.append(_finite(chunk[k]))
    return ts, vs


def clean(values: list[float]) -> np.ndarray:
    """NaN/Inf из VictoriaMetrics приходят на разрывах scrape — выкидываем."""
    arr = np.asarray(values, dtype=float)
    return arr[np.isfinite(arr)]


def percentile(values: np.ndarray, q: float) -> float:
    return float(np.percentile(values, q)) if values.size else 0.0


def _finite(value: float) -> float:
    v = float(value)
    return v if math.isfinite(v) else 0.0
