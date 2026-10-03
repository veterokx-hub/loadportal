"""Сборка находок в сюжеты.

Десять находок в списке — это десять задач. Те же десять находок, собранные в
две цепочки, — это две задачи, и у каждой понятно, с чего начинать.

Группируем по двум условиям одновременно: пересечение во времени и наличие
причинной связи в каталоге. Одного времени мало — на плато всё пересекается со
всем; одной связи мало — GC и время ответа связаны всегда, но если они разъехались
на полчаса, это разные истории.
"""
from __future__ import annotations

from datetime import datetime

from .catalog import CATALOG
from .models import Correlation, Finding, Severity, SEVERITY_ORDER

# Допуск на рассинхрон: причина и следствие редко видны в одной точке сетки.
START_TOLERANCE_SEC = 300
MIN_OVERLAP_RATIO = 0.3


def build(findings: list[Finding]) -> list[Correlation]:
    if len(findings) < 2:
        return []

    parent = {f.id: f.id for f in findings}
    edges: list[tuple[Finding, Finding]] = []
    for i, left in enumerate(findings):
        for right in findings[i + 1 :]:
            direction = _causal_direction(left, right)
            if direction is None or not _time_related(left, right):
                continue
            cause, effect = direction
            edges.append((cause, effect))
            _union(parent, left.id, right.id)

    groups: dict[str, list[Finding]] = {}
    for finding in findings:
        groups.setdefault(_find(parent, finding.id), []).append(finding)

    out: list[Correlation] = []
    for members in groups.values():
        if len(members) < 2:
            continue
        ordered = _order(members, edges)
        severity = min((m.severity for m in members), key=lambda s: SEVERITY_ORDER[s])
        root = ordered[0]
        out.append(
            Correlation(
                id=f"corr-{root.id}",
                finding_ids=[m.id for m in ordered],
                from_ts=min(m.from_ts for m in members),
                to_ts=max(m.to_ts for m in members),
                severity=severity,
                title=f"{root.metric_title} тянет за собой ещё {len(members) - 1}",
                chain=list(dict.fromkeys(m.metric_title for m in ordered)),
                summary=_summary(ordered),
                confidence=_confidence(members, edges),
            )
        )
    out.sort(key=lambda c: (SEVERITY_ORDER[c.severity], c.from_ts))
    return out


def _causal_direction(a: Finding, b: Finding) -> tuple[Finding, Finding] | None:
    """Ребро каталога в любую сторону; при равенстве причина — та, что началась раньше."""
    a_to_b = b.metric in CATALOG.causal.get(a.metric, [])
    b_to_a = a.metric in CATALOG.causal.get(b.metric, [])
    if a_to_b and b_to_a:
        return (a, b) if a.from_ts <= b.from_ts else (b, a)
    if a_to_b:
        return a, b
    if b_to_a:
        return b, a
    return None


def _time_related(a: Finding, b: Finding) -> bool:
    if abs(_sec(a.from_ts) - _sec(b.from_ts)) <= START_TOLERANCE_SEC:
        return True
    overlap = min(_sec(a.to_ts), _sec(b.to_ts)) - max(_sec(a.from_ts), _sec(b.from_ts))
    if overlap <= 0:
        return False
    shortest = min(_sec(a.to_ts) - _sec(a.from_ts), _sec(b.to_ts) - _sec(b.from_ts))
    return shortest > 0 and overlap / shortest >= MIN_OVERLAP_RATIO


def _order(members: list[Finding], edges: list[tuple[Finding, Finding]]) -> list[Finding]:
    """Сначала причины, потом следствия.

    Глубина считается послойно: узел лежит на уровне ниже самой глубокой своей
    причины. Сортировки по числу входящих рёбер мало — она ставит следствие
    второго порядка рядом с прямым следствием, и цепочка перестаёт читаться
    как рассказ. Число проходов ограничено, чтобы цикл в каталоге связей не
    зациклил разбор.
    """
    ids = {m.id for m in members}
    inner = [(c.id, e.id) for c, e in edges if c.id in ids and e.id in ids]
    depth = {m.id: 0 for m in members}
    for _ in range(len(members)):
        changed = False
        for cause, effect in inner:
            if depth[effect] < depth[cause] + 1:
                depth[effect] = depth[cause] + 1
                changed = True
        if not changed:
            break
    return sorted(members, key=lambda m: (depth[m.id], m.from_ts, SEVERITY_ORDER[m.severity]))


def _summary(ordered: list[Finding]) -> str:
    root = ordered[0]
    # Названия метрик перечисляются как есть: lower() портит аббревиатуры —
    # «Загрузка пула БД» превращалась в «загрузка пула бд».
    tail = ", ".join(m.metric_title for m in ordered[1:4])
    more = f" и ещё {len(ordered) - 4}" if len(ordered) > 4 else ""
    return (
        f"Раньше остальных сдвинулся показатель «{root.metric_title}» "
        f"({root.from_ts.strftime('%H:%M:%S')}), следом — {tail}{more}. "
        "Похоже на одну причину, а не на несколько независимых проблем: "
        "начинайте с первого звена, остальное с большой вероятностью уйдёт вместе с ним."
    )


def _confidence(members: list[Finding], edges: list[tuple[Finding, Finding]]) -> int:
    ids = {m.id for m in members}
    inner = sum(1 for cause, effect in edges if cause.id in ids and effect.id in ids)
    density = inner / max(len(members) - 1, 1)
    return int(min(95, 45 + 15 * min(len(members), 4) + 10 * min(density, 1.0)))


def _union(parent: dict[str, str], a: str, b: str) -> None:
    ra, rb = _find(parent, a), _find(parent, b)
    if ra != rb:
        parent[rb] = ra


def _find(parent: dict[str, str], node: str) -> str:
    while parent[node] != node:
        parent[node] = parent[parent[node]]
        node = parent[node]
    return node


def _sec(value: datetime) -> int:
    return int(value.timestamp())
