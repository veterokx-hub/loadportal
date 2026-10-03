"""Форматирование чисел для текста находок.

Формулировки собираются на бэкенде, потому что их надо один раз показать в UI,
второй раз положить в отчёт и третий — отдать наружу. Число без единицы
измерения («держалось на 0.94») читателю ничего не говорит.
"""
from __future__ import annotations

import math

_KIB = 1024.0


def value(number: float, unit: str) -> str:
    if number is None or not math.isfinite(number):
        return "—"
    match unit:
        case "seconds":
            return _seconds(number)
        case "bytes":
            return _bytes(number)
        case "percent":
            return f"{_num(number)} %"
        case "cores":
            # Доли ядра читаются как милликоры — так же, как их пишут в манифестах.
            return f"{_num(number * 1000, 0)} мCPU" if abs(number) < 1 else f"{_num(number)} CPU"
        case "rps":
            return f"{_num(number, 0)} RPS"
        case "ratio":
            return f"×{_num(number)}"
        case "count_per_sec":
            return f"{_num(number)}/с"
        case "count":
            return _num(number, 0)
        case _:
            return _num(number)


def duration(seconds: float) -> str:
    total = int(round(seconds))
    if total < 60:
        return f"{total} с"
    if total < 3600:
        rest = total % 60
        return f"{total // 60} мин" + (f" {rest} с" if rest else "")
    rest_min = (total % 3600) // 60
    return f"{total // 3600} ч" + (f" {rest_min} мин" if rest_min else "")


def delta_pct(observed: float, baseline: float) -> float | None:
    """Относительное изменение в процентах, либо None при нулевой базе.

    Отношение к нулю не определено, и подставлять вместо него ноль нельзя:
    у правила «очередь за соединением > 0» отчёт показывал «отклонение 0,00»
    рядом с вердиктом «критично». Там, где базы нет, процента тоже нет.
    """
    if baseline is None or abs(baseline) < 1e-9:
        return None
    return (observed - baseline) / abs(baseline) * 100.0


def signed_pct(pct: float) -> str:
    sign = "+" if pct >= 0 else "−"
    return f"{sign}{_num(abs(pct), 0 if abs(pct) >= 100 else 1)} %"


def _seconds(number: float) -> str:
    if abs(number) < 1.0:
        ms = number * 1000
        return f"{_num(ms, 0 if abs(ms) >= 10 else None)} мс"
    return f"{_num(number)} с"


def _bytes(number: float) -> str:
    step = abs(number)
    for suffix in ("Б", "КиБ", "МиБ", "ГиБ"):
        if step < _KIB or suffix == "ГиБ":
            digits = 0 if suffix in ("Б", "КиБ") else 2
            return f"{_num(math.copysign(step, number), digits)} {suffix}"
        step /= _KIB
    return f"{_num(number)} Б"


def _num(number: float, digits: int | None = None) -> str:
    """Знаков после запятой ровно столько, чтобы значение осталось различимым.

    Фиксированные два знака превращают производные метрики вроде «CPU на запрос»
    в бессмысленное «0,00 → 0,00».
    """
    if digits is None:
        magnitude = abs(number)
        if magnitude >= 100:
            digits = 0
        elif magnitude >= 10:
            digits = 1
        elif magnitude >= 0.1 or magnitude == 0:
            digits = 2
        else:
            digits = min(6, 2 - int(math.floor(math.log10(magnitude))))
    text = f"{number:.{digits}f}"
    return text.replace(".", ",")
