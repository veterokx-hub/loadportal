"""От находок к гипотезам о причине в коде.

Слой намеренно детерминированный: сопоставление шаблонов из hypotheses.yaml с
набором находок. Никакой модели здесь нет и не нужно — набор комбинаций конечен,
а объяснимость важнее богатства формулировок. Точка расширения для ИИ — enrich().

Уверенность никогда не доходит до 100: это гипотеза, а не диагноз. Модуль не
видит код и не знает, что вчера задеплоили.
"""
from __future__ import annotations

from .catalog import CATALOG, HypothesisPattern, PatternCond
from .models import Correlation, Finding, Hypothesis, Severity

MAX_CONFIDENCE = 95
MAX_HYPOTHESES = 4


def build(findings: list[Finding], correlations: list[Correlation]) -> list[Hypothesis]:
    out: list[Hypothesis] = []
    for pattern in CATALOG.patterns:
        matched = _match(pattern, findings)
        if matched is None:
            continue
        confidence, ids = matched
        out.append(
            Hypothesis(
                id=f"hyp-{pattern.id}",
                pattern=pattern.id,
                title=pattern.title,
                body=pattern.body,
                checks=list(pattern.checks),
                confidence=confidence,
                severity=Severity(pattern.severity),
                finding_ids=ids,
                correlation_id=_correlation_for(ids, correlations),
            )
        )
    out.sort(key=lambda h: -h.confidence)
    return out[:MAX_HYPOTHESES]


def _match(pattern: HypothesisPattern, findings: list[Finding]) -> tuple[int, list[str]] | None:
    ids: list[str] = []
    confidence = pattern.base_confidence

    for cond in pattern.requires:
        hit = _first(cond, findings)
        if hit is None:
            return None
        confidence += cond.weight
        ids.append(hit.id)

    for cond in pattern.absent:
        if _first(cond, findings) is not None:
            return None

    for cond in pattern.boosts:
        hit = _first(cond, findings)
        if hit is not None:
            confidence += cond.weight
            ids.append(hit.id)

    return min(confidence, MAX_CONFIDENCE), list(dict.fromkeys(ids))


def _first(cond: PatternCond, findings: list[Finding]) -> Finding | None:
    for finding in findings:
        if finding.metric != cond.metric:
            continue
        if cond.detector != "any" and finding.detector.value != cond.detector:
            continue
        if cond.direction != "any" and finding.labels.get("direction", "up") != cond.direction:
            continue
        return finding
    return None


def _correlation_for(finding_ids: list[str], correlations: list[Correlation]) -> str:
    best, best_hits = "", 0
    for corr in correlations:
        hits = len(set(finding_ids) & set(corr.finding_ids))
        if hits > best_hits:
            best, best_hits = corr.id, hits
    return best


def enrich(hypotheses: list[Hypothesis]) -> list[Hypothesis]:
    """Точка подключения LLM.

    Контракт расширения: модель получает только уже найденные детерминированные
    факты (метрика, числа, окно) и переписывает формулировку. Порождать новые
    находки ей запрещено — иначе отчёт перестаёт быть воспроизводимым, а
    источником «фактов» становится генератор текста.
    """
    return hypotheses
