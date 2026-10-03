"""Разбор ссылки на дашборд Grafana.

Инженер приходит в модуль со ссылкой, которую только что смотрел. Требовать от
него переписать cluster/namespace/service руками — верный способ, чтобы модулем
не пользовались. Поэтому ссылка — полноценный способ ввода, а форма показывает,
что именно из неё удалось достать, и позволяет поправить.

Ссылка только парсится: ходить по ней сервер не будет.
"""
from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

from .models import AnalysisTarget, TargetSuggestion

# Одно и то же поле в разных дашбордах называется по-разному.
ALIASES: dict[str, tuple[str, ...]] = {
    "cluster": ("cluster", "k8s_cluster", "datacenter", "dc", "env", "environment"),
    "namespace": ("namespace", "ns", "project", "kubernetes_namespace"),
    "service": ("service", "app", "application", "workload", "deployment", "job", "microservice"),
    "container": ("container", "container_name"),
}

_RELATIVE = re.compile(r"^now(?:-(\d+)([smhdw]))?", re.IGNORECASE)
_UNIT_SECONDS = {"s": 1, "m": 60, "h": 3600, "d": 86400, "w": 604800}


def parse(url: str) -> TargetSuggestion:
    parsed = urlparse(url.strip())
    params = parse_qs(parsed.query)
    values = {key.lower(): raw[0] for key, raw in params.items() if raw}

    target = AnalysisTarget()
    matched: list[str] = []
    unmatched: list[str] = []
    for field, aliases in ALIASES.items():
        found = _lookup(values, aliases)
        if found:
            setattr(target, field, found)
            matched.append(field)
        else:
            unmatched.append(field)

    # Дашборды нередко показывают под, а не сервис: срезаем хвост ReplicaSet.
    if not target.service and (pod := _lookup(values, ("pod", "pod_name", "instance"))):
        target.service = re.sub(r"-[a-z0-9]{6,10}-[a-z0-9]{5}$", "", pod)
        if target.service:
            matched.append("service")
            unmatched = [u for u in unmatched if u != "service"]

    now = datetime.now(UTC)
    return TargetSuggestion(
        target=target,
        window_from=_moment(values.get("from"), now),
        window_to=_moment(values.get("to"), now),
        dashboard_uid=_uid(parsed.path),
        matched=matched,
        unmatched=unmatched,
    )


def _lookup(values: dict[str, str], aliases: tuple[str, ...]) -> str:
    for alias in aliases:
        raw = values.get(f"var-{alias}") or values.get(alias)
        # $__all и пустой выбор значат «все» — как цель анализа это бесполезно.
        if raw and raw not in ("$__all", "All", "all"):
            return raw.strip()
    return ""


def _moment(raw: str | None, now: datetime) -> datetime | None:
    if not raw:
        return None
    raw = raw.strip()
    if raw.isdigit():
        number = int(raw)
        # Grafana отдаёт миллисекунды; десятизначное значение — уже секунды.
        return datetime.fromtimestamp(number / 1000 if number > 10**11 else number, UTC)
    match = _RELATIVE.match(raw)
    if match:
        if not match.group(1):
            return now
        return now - timedelta(seconds=int(match.group(1)) * _UNIT_SECONDS[match.group(2).lower()])
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def _uid(path: str) -> str:
    parts = [p for p in path.split("/") if p]
    if len(parts) >= 2 and parts[0] in ("d", "d-solo", "goto"):
        return parts[1]
    return ""
