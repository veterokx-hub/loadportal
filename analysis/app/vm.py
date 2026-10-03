"""Клиент VictoriaMetrics.

Адрес источника берётся только из конфигурации сервиса и никогда из тела запроса:
пользователь задаёт цель анализа, но не то, куда модуль пойдёт по сети.

Три вещи, которые здесь важнее удобства API:
  • шаг сетки адаптивный — 24-часовой тест не должен тянуть миллионы точек;
  • параллелизм ограничен семафором — сорок одновременных query_range кладут vmselect;
  • на таймаут отвечаем огрублением шага, а не повтором того же запроса.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field

import httpx

log = logging.getLogger(__name__)

# Больше точек на ряд не даёт новой информации: детекторы всё равно работают
# на масштабе десятков секунд, а не отдельных скрейпов.
MAX_POINTS_PER_SERIES = 720
MIN_STEP_SEC = 15
MAX_STEP_SEC = 600


@dataclass
class Budget:
    """Учёт стоимости анализа. Попадает в отчёт: видно, чем оплачен вывод."""

    queries: int = 0
    points: int = 0
    duration_ms: int = 0
    step_sec: int = 0
    refined: int = 0
    degraded: bool = False
    degraded_reason: str = ""
    errors: list[str] = field(default_factory=list)


def choose_step(window_sec: float, max_points: int = MAX_POINTS_PER_SERIES) -> int:
    """Шаг сетки под длину окна, округлённый до «человеческих» значений."""
    raw = max(window_sec / max(max_points, 1), MIN_STEP_SEC)
    for candidate in (15, 30, 60, 120, 300, 600):
        if raw <= candidate:
            return candidate
    return MAX_STEP_SEC


class VictoriaMetricsClient:
    def __init__(
        self,
        base_url: str,
        http: httpx.AsyncClient,
        concurrency: int = 4,
        timeout_sec: float = 20.0,
        bearer: str = "",
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self._http = http
        self._sem = asyncio.Semaphore(max(concurrency, 1))
        self._timeout = timeout_sec
        self._headers = {"Authorization": f"Bearer {bearer}"} if bearer else {}

    @property
    def configured(self) -> bool:
        return bool(self.base_url)

    async def ping(self) -> bool:
        if not self.configured:
            return False
        try:
            res = await self._http.get(
                f"{self.base_url}/api/v1/labels", headers=self._headers, timeout=3.0
            )
            return res.status_code < 500
        except httpx.HTTPError:
            return False

    async def query_range(
        self, expr: str, start: int, end: int, step: int, budget: Budget
    ) -> list[tuple[float, float]]:
        """Один ряд за окно. Пустой список — метрики нет; это не ошибка."""
        async with self._sem:
            samples = await self._request(expr, start, end, step, budget, retry=True)
        budget.queries += 1
        budget.points += len(samples)
        return samples

    async def _request(
        self, expr: str, start: int, end: int, step: int, budget: Budget, retry: bool
    ) -> list[tuple[float, float]]:
        try:
            res = await self._http.post(
                f"{self.base_url}/api/v1/query_range",
                data={"query": expr, "start": start, "end": end, "step": f"{step}s"},
                headers=self._headers,
                timeout=self._timeout,
            )
        except httpx.HTTPError as ex:
            if retry:
                # Огрубляем шаг вдвое: тот же запрос по тому же окну снова упрётся в таймаут.
                budget.degraded = True
                budget.degraded_reason = "источник не успел ответить, шаг сетки увеличен"
                return await self._request(expr, start, end, step * 2, budget, retry=False)
            log.warning("VictoriaMetrics недоступна: %s", ex)
            budget.errors.append(str(ex))
            return []

        if res.status_code >= 500 and retry:
            budget.degraded = True
            budget.degraded_reason = f"источник вернул {res.status_code}, шаг сетки увеличен"
            return await self._request(expr, start, end, step * 2, budget, retry=False)
        if res.status_code != 200:
            log.warning("VictoriaMetrics %s на запросе %s", res.status_code, expr[:120])
            budget.errors.append(f"HTTP {res.status_code}")
            return []

        return _parse_matrix(res.json())


def _parse_matrix(payload: dict) -> list[tuple[float, float]]:
    """Из ответа берём первый ряд: все выражения каталога агрегированы до одного."""
    if payload.get("status") != "success":
        return []
    result = payload.get("data", {}).get("result", [])
    if not result:
        return []
    out: list[tuple[float, float]] = []
    for ts, raw in result[0].get("values", []):
        try:
            out.append((float(ts), float(raw)))
        except (TypeError, ValueError):
            continue
    return out
