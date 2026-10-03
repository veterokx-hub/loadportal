"""Загрузка каталогов: метрики, правила, гипотезы.

Каталоги — YAML рядом с кодом. Разделение сделано ради НТ-инженера: имена рядов,
пороги и формулировки правятся без пересборки логики. Файлы читаются один раз
при импорте, ошибка в YAML валит сервис на старте, а не на первом анализе.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from string import Template
from typing import Any

import yaml

CATALOG_DIR = Path(__file__).parent / "catalog"


@dataclass(frozen=True)
class MetricSpec:
    key: str
    title: str
    group: str
    unit: str
    importance: int
    expr: str
    runtime: str = "any"
    hint: str = ""
    demo: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class DerivedSpec:
    key: str
    title: str
    group: str
    unit: str
    importance: int
    formula: str
    numerator: str
    denominator: str
    runtime: str = "any"
    hint: str = ""


@dataclass(frozen=True)
class Invariant:
    id: str
    title: str
    metric: str
    op: str
    value: float
    for_sec: int
    phases: tuple[str, ...]
    severity: str
    cls: str
    summary: str
    next_step: str
    slo_from: str = ""
    slo_scale: float = 1.0
    baseline_from_phase: str = ""
    baseline_ratio: float = 1.0


@dataclass(frozen=True)
class PatternCond:
    metric: str
    detector: str = "any"
    direction: str = "any"
    weight: int = 0


@dataclass(frozen=True)
class HypothesisPattern:
    id: str
    title: str
    severity: str
    base_confidence: int
    requires: tuple[PatternCond, ...]
    boosts: tuple[PatternCond, ...]
    absent: tuple[PatternCond, ...]
    body: str
    checks: tuple[str, ...]


class Catalog:
    def __init__(self, directory: Path = CATALOG_DIR) -> None:
        metrics_doc = _load(directory / "metrics.yaml")
        rules_doc = _load(directory / "rules.yaml")
        hypo_doc = _load(directory / "hypotheses.yaml")

        self.selectors: dict[str, str] = metrics_doc.get("selectors", {})
        self.metrics: dict[str, MetricSpec] = {}
        for raw in metrics_doc.get("metrics", []):
            spec = MetricSpec(
                key=raw["key"],
                title=raw["title"],
                group=raw["group"],
                unit=raw.get("unit", ""),
                importance=int(raw.get("importance", 1)),
                expr=raw["expr"],
                runtime=raw.get("runtime", "any"),
                hint=raw.get("hint", ""),
                demo=raw.get("demo", {}) or {},
            )
            self.metrics[spec.key] = spec

        self.derived: dict[str, DerivedSpec] = {}
        for raw in metrics_doc.get("derived", []):
            spec = DerivedSpec(
                key=raw["key"],
                title=raw["title"],
                group=raw["group"],
                unit=raw.get("unit", ""),
                importance=int(raw.get("importance", 1)),
                formula=raw.get("formula", "ratio"),
                numerator=raw["numerator"],
                denominator=raw["denominator"],
                runtime=raw.get("runtime", "any"),
                hint=raw.get("hint", ""),
            )
            self.derived[spec.key] = spec

        self.ruleset_version: str = str(rules_doc.get("ruleset_version", "0"))
        self.detectors: dict[str, Any] = rules_doc.get("detectors", {})
        self.expected: dict[str, list[str]] = rules_doc.get("expected", {})
        self.causal: dict[str, list[str]] = rules_doc.get("causal", {})
        self.invariants: list[Invariant] = [
            Invariant(
                id=raw["id"],
                title=raw["title"],
                metric=raw["metric"],
                op=raw["op"],
                value=float(raw.get("value", 0)),
                for_sec=int(raw.get("for_sec", 0)),
                phases=tuple(raw.get("phases", []) or []),
                severity=raw.get("severity", "major"),
                cls=raw.get("class", "saturation"),
                summary=raw.get("summary", ""),
                next_step=raw.get("next_step", ""),
                slo_from=raw.get("slo_from", ""),
                slo_scale=float(raw.get("slo_scale", 1.0)),
                baseline_from_phase=raw.get("baseline_from_phase", ""),
                baseline_ratio=float(raw.get("baseline_ratio", 1.0)),
            )
            for raw in rules_doc.get("invariants", [])
        ]

        self.patterns: list[HypothesisPattern] = [
            HypothesisPattern(
                id=raw["id"],
                title=raw["title"],
                severity=raw.get("severity", "major"),
                base_confidence=int(raw.get("base_confidence", 50)),
                requires=tuple(_conds(raw.get("requires"))),
                boosts=tuple(_conds(raw.get("boosts"))),
                absent=tuple(_conds(raw.get("absent"))),
                body=" ".join(str(raw.get("body", "")).split()),
                checks=tuple(raw.get("checks", []) or []),
            )
            for raw in hypo_doc.get("patterns", [])
        ]

    def title(self, key: str) -> str:
        spec = self.metrics.get(key) or self.derived.get(key)
        return spec.title if spec else key

    def unit(self, key: str) -> str:
        spec = self.metrics.get(key) or self.derived.get(key)
        return spec.unit if spec else ""

    def group(self, key: str) -> str:
        spec = self.metrics.get(key) or self.derived.get(key)
        return spec.group if spec else "other"

    def importance(self, key: str) -> int:
        spec = self.metrics.get(key) or self.derived.get(key)
        return spec.importance if spec else 1

    def for_runtime(self, runtime: str) -> list[MetricSpec]:
        """Метрики JVM не нужны для Go-сервиса и наоборот — не тратим запросы."""
        if runtime in ("", "auto"):
            return list(self.metrics.values())
        return [m for m in self.metrics.values() if m.runtime in ("any", runtime)]

    def render(self, spec: MetricSpec, target: dict[str, str], step_sec: int) -> str:
        """Подстановка цели и шага в выражение. Двухэтапно: сначала селекторы, потом expr."""
        base = {
            "cluster": target.get("cluster", ""),
            "namespace": target.get("namespace", ""),
            "service": target.get("service", ""),
            "container": target.get("container") or target.get("service", ""),
        }
        selectors = {name: Template(tpl).safe_substitute(base) for name, tpl in self.selectors.items()}
        return Template(spec.expr).safe_substitute(
            **base, **selectors, step=f"{max(step_sec, 1)}s"
        )


def _conds(raw: list[dict[str, Any]] | None) -> list[PatternCond]:
    return [
        PatternCond(
            metric=item["metric"],
            detector=item.get("detector", "any"),
            direction=item.get("direction", "any"),
            weight=int(item.get("weight", 0)),
        )
        for item in (raw or [])
    ]


def _load(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


CATALOG = Catalog()
