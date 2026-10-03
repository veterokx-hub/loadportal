"""analyzer — сервис анализа спецификаций API.

Вход: OpenAPI (URL/контент) или Postman-коллекция.
Выход: нормализованный ScenarioDraft.

Детерминированная реализация. Точка расширения для ИИ — функция enrich().
"""
from __future__ import annotations

import hmac
import os
import time
from contextlib import asynccontextmanager
from urllib.parse import urljoin

import httpx
from fastapi import FastAPI, HTTPException, Request, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from .fetch_guard import assert_safe_fetch_url
from .metrics import ANALYZE_DURATION, ANALYZE_TOTAL, FETCH_DURATION, REQUESTS_IN_DRAFT
from .models import AnalyzeRequest, ScenarioDraft, SourceType
from .openapi_parser import parse_openapi
from .postman_parser import parse_postman

_INTERNAL_TOKEN = os.getenv("LOADTEST_INTERNAL_TOKEN", "").strip()

# Состояние приложения: один AsyncClient на весь процесс.
# Создавать клиент на каждый запрос — значит поднимать новый пул TCP/TLS каждый раз;
# при частых анализах по URL это даёт лишние рукопожатия и расход дескрипторов.
_app_state: dict[str, httpx.AsyncClient] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Поднимает общий HTTP-клиент при старте и закрывает его при остановке."""
    # verify=False: в тестовой среде часто стоят corp CA / self-signed сертификаты.
    _app_state["http"] = httpx.AsyncClient(
        timeout=20.0,
        follow_redirects=False,
        verify=False,
    )
    try:
        yield
    finally:
        await _app_state["http"].aclose()
        _app_state.clear()


app = FastAPI(
    title="Load Test Portal — Analyzer",
    version="0.1.0",
    lifespan=lifespan,
)


def _http() -> httpx.AsyncClient:
    """Общий клиент модуля. Доступен только между стартом и остановкой приложения."""
    client = _app_state.get("http")
    if client is None:
        raise RuntimeError("HTTP-клиент analyzer не инициализирован")
    return client


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "analyzer"}


@app.get("/ready")
def ready() -> dict[str, str]:
    """Readiness probe (k8s). Stateless — всегда ready при поднятом процессе."""
    return {"status": "ok", "service": "analyzer"}


@app.get("/metrics")
def metrics() -> Response:
    """Экспозиция Prometheus-метрик для VictoriaMetrics."""
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


def _require_internal(token: str | None) -> None:
    if not _INTERNAL_TOKEN:
        return
    if not _tokens_equal(_INTERNAL_TOKEN, token or ""):
        raise HTTPException(status_code=401, detail="Требуется внутренний токен")


def _tokens_equal(expected: str, provided: str) -> bool:
    left = hmac.new(b"ltp", expected.encode(), "sha256").digest()
    right = hmac.new(b"ltp", provided.encode(), "sha256").digest()
    return hmac.compare_digest(left, right)


@app.post("/analyze", response_model=ScenarioDraft)
async def analyze(req: AnalyzeRequest, request: Request) -> ScenarioDraft:
    _require_internal(request.headers.get("X-Internal-Token"))
    source = req.source_type.value if isinstance(req.source_type, SourceType) else str(req.source_type)
    started = time.perf_counter()
    try:
        content = await _resolve_content(req)
        if req.source_type == SourceType.OPENAPI:
            draft = parse_openapi(content, name=req.name)
        elif req.source_type == SourceType.POSTMAN:
            draft = parse_postman(content, name=req.name)
        else:  # pragma: no cover
            raise HTTPException(status_code=400, detail=f"Неизвестный source_type: {req.source_type}")
        draft = enrich(draft)
        ANALYZE_TOTAL.labels(source_type=source, result="success").inc()
        ANALYZE_DURATION.labels(source_type=source, result="success").observe(
            time.perf_counter() - started
        )
        REQUESTS_IN_DRAFT.observe(len(draft.requests or []))
        return draft
    except HTTPException:
        ANALYZE_TOTAL.labels(source_type=source, result="failure").inc()
        ANALYZE_DURATION.labels(source_type=source, result="failure").observe(
            time.perf_counter() - started
        )
        raise
    except Exception as exc:  # noqa: BLE001
        ANALYZE_TOTAL.labels(source_type=source, result="failure").inc()
        ANALYZE_DURATION.labels(source_type=source, result="failure").observe(
            time.perf_counter() - started
        )
        raise HTTPException(status_code=422, detail="Не удалось разобрать спецификацию") from exc


def _is_openapi_spec(text: str) -> bool:
    """Похоже ли содержимое на саму спецификацию OpenAPI/Swagger (а не HTML/конфиг UI)."""
    t = text.lstrip()
    low = t[:16].lower()
    if low.startswith("openapi:") or low.startswith("swagger:"):
        return True
    if t[:1] in ("{", "["):
        head = t[:8000].lower()
        return (
            '"openapi"' in head
            or '"swagger"' in head
            or '"paths"' in head
            or '"definitions"' in head
            or '"components"' in head
        )
    return False


def _swagger_config_urls(text: str, base_url: str) -> list[str]:
    """springdoc swagger-config: {"url": "..."} или {"urls": [{"url": "..."}]}."""
    import json
    from urllib.parse import urljoin

    try:
        data = json.loads(text)
    except Exception:  # noqa: BLE001
        return []
    if not isinstance(data, dict):
        return []
    urls: list[str] = []
    if isinstance(data.get("url"), str):
        urls.append(data["url"])
    for u in data.get("urls") or []:
        if isinstance(u, dict) and isinstance(u.get("url"), str):
            urls.append(u["url"])
    return [urljoin(base_url, u) for u in urls]


def _spec_candidates(url: str) -> list[str]:
    """Вероятные URL самой спеки для страницы Swagger UI (springdoc/springfox).

    Учитывает контекст сервиса и дублированные сегменты swagger-ui, пробует и
    контекстный путь, и корень.
    """
    from urllib.parse import urlsplit, urlunsplit

    parts = urlsplit(url)
    segs = [s for s in parts.path.split("/") if s]
    cut = len(segs)
    for i, s in enumerate(segs):
        if s.startswith("swagger-ui") or s == "swagger" or s.endswith(".html"):
            cut = i
            break
    base_segs = segs[:cut]

    bases: list[str] = []
    if base_segs:
        bases.append("/" + "/".join(base_segs))
    bases.append("")  # корень

    suffixes = [
        "/v3/api-docs/swagger-config", "/v3/api-docs", "/v3/api-docs.yaml",
        "/v2/api-docs", "/api-docs", "/openapi.json", "/openapi.yaml", "/swagger.json",
    ]
    out: list[str] = []
    for b in bases:
        for s in suffixes:
            u = urlunsplit((parts.scheme, parts.netloc, b + s, "", ""))
            if u not in out:
                out.append(u)
    return out


async def _resolve_content(req: AnalyzeRequest) -> str:
    """Возвращает текст спецификации: либо из тела запроса, либо скачанный по URL."""
    if req.content:
        return req.content
    if not req.url:
        raise HTTPException(status_code=400, detail="Нужно указать url или content")

    client = _http()
    fetch_started = time.perf_counter()
    try:
        async def _fetch_spec(u: str, depth: int = 0) -> str | None:
            """Возвращает текст спеки по URL, разворачивая swagger-config при необходимости."""
            try:
                r = await _get_checked(client, u)
            except HTTPException:
                return None
            except httpx.HTTPError:
                return None
            if r.status_code != 200:
                return None
            body = r.text
            if _is_openapi_spec(body):
                return body
            if depth < 2:
                for cu in _swagger_config_urls(body, str(r.url)):
                    found = await _fetch_spec(cu, depth + 1)
                    if found:
                        return found
            return None

        resp = await _get_checked(client, req.url)
        resp.raise_for_status()
        text = resp.text
        if _is_openapi_spec(text):
            FETCH_DURATION.labels(result="success").observe(time.perf_counter() - fetch_started)
            return text

        # req.url мог быть swagger-config — развернём ссылки
        for cu in _swagger_config_urls(text, str(resp.url)):
            found = await _fetch_spec(cu)
            if found:
                FETCH_DURATION.labels(result="success").observe(time.perf_counter() - fetch_started)
                return found

        # Иначе это страница Swagger UI — перебираем вероятные URL спеки
        for candidate in _spec_candidates(str(resp.url)):
            found = await _fetch_spec(candidate)
            if found:
                FETCH_DURATION.labels(result="success").observe(time.perf_counter() - fetch_started)
                return found

        FETCH_DURATION.labels(result="failure").observe(time.perf_counter() - fetch_started)
        raise HTTPException(
            status_code=422,
            detail=(
                "По ссылке пришёл HTML (страница Swagger UI), а не спецификация, "
                "и автопоиск спеки не удался. Укажите URL самой спеки "
                "(например .../v3/api-docs) или вставьте содержимое вручную."
            ),
        )
    except HTTPException:
        FETCH_DURATION.labels(result="failure").observe(time.perf_counter() - fetch_started)
        raise
    except httpx.ConnectError as exc:
        FETCH_DURATION.labels(result="failure").observe(time.perf_counter() - fetch_started)
        raise HTTPException(status_code=400, detail="Не удалось подключиться по URL") from exc
    except httpx.HTTPError as exc:
        FETCH_DURATION.labels(result="failure").observe(time.perf_counter() - fetch_started)
        raise HTTPException(status_code=400, detail="Не удалось загрузить URL") from exc


async def _get_checked(client: httpx.AsyncClient, url: str) -> httpx.Response:
    """GET с проверкой каждого hop редиректа (metadata/compose DNS)."""
    current = url
    for _ in range(4):
        assert_safe_fetch_url(current)
        resp = await client.get(current)
        if resp.is_redirect:
            loc = resp.headers.get("location")
            if not loc:
                return resp
            current = urljoin(str(resp.url), loc)
            continue
        return resp
    raise HTTPException(status_code=400, detail="Слишком много редиректов")


def enrich(draft: ScenarioDraft) -> ScenarioDraft:
    """Точка расширения для ИИ-слоя.

    Сейчас — no-op (детерминированный результат). В будущем здесь можно:
    - переупорядочить запросы в реалистичный пользовательский сценарий;
    - предложить корреляции (значение из ответа A -> параметр B);
    - подобрать стратегии генерации параметров.
    """
    return draft


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("APP_PORT", "8000")))
