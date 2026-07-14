"""analyzer — сервис анализа спецификаций API.

Вход: OpenAPI (URL/контент) или Postman-коллекция.
Выход: нормализованный ScenarioDraft.

Детерминированная реализация. Точка расширения для ИИ — функция enrich().
"""
from __future__ import annotations

import os

import httpx
from fastapi import FastAPI, HTTPException

from .models import AnalyzeRequest, ScenarioDraft, SourceType
from .openapi_parser import parse_openapi
from .postman_parser import parse_postman

app = FastAPI(title="Load Test Portal — Analyzer", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/analyze", response_model=ScenarioDraft)
async def analyze(req: AnalyzeRequest) -> ScenarioDraft:
    content = await _resolve_content(req)
    try:
        if req.source_type == SourceType.OPENAPI:
            draft = parse_openapi(content, name=req.name)
        elif req.source_type == SourceType.POSTMAN:
            draft = parse_postman(content, name=req.name)
        else:  # pragma: no cover
            raise HTTPException(status_code=400, detail=f"Неизвестный source_type: {req.source_type}")
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"Не удалось разобрать спецификацию: {exc}") from exc

    return enrich(draft)


def _tls_verify():
    """Настройка проверки TLS для корпоративных сред.

    - ANALYZER_CA_BUNDLE=/path/to/corp-ca.pem — доверять корпоративному CA (рекомендуется);
    - ANALYZER_VERIFY_SSL=false — полностью отключить проверку (небезопасно, только для отладки).
    По умолчанию проверка включена.
    """
    ca_bundle = os.getenv("ANALYZER_CA_BUNDLE")
    if ca_bundle:
        return ca_bundle
    verify = os.getenv("ANALYZER_VERIFY_SSL", "true").strip().lower()
    if verify in ("false", "0", "no", "off"):
        return False
    return True


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
    if req.content:
        return req.content
    if not req.url:
        raise HTTPException(status_code=400, detail="Нужно указать url или content")

    verify = _tls_verify()
    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True, verify=verify) as client:

            async def _fetch_spec(u: str, depth: int = 0) -> str | None:
                """Возвращает текст спеки по URL, разворачивая swagger-config при необходимости."""
                try:
                    r = await client.get(u)
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

            resp = await client.get(req.url)
            resp.raise_for_status()
            text = resp.text
            if _is_openapi_spec(text):
                return text

            # req.url мог быть swagger-config — развернём ссылки
            for cu in _swagger_config_urls(text, str(resp.url)):
                found = await _fetch_spec(cu)
                if found:
                    return found

            # Иначе это страница Swagger UI — перебираем вероятные URL спеки
            for candidate in _spec_candidates(str(resp.url)):
                found = await _fetch_spec(candidate)
                if found:
                    return found

            raise HTTPException(
                status_code=422,
                detail=(
                    "По ссылке пришёл HTML (страница Swagger UI), а не спецификация, "
                    "и автопоиск спеки не удался. Укажите URL самой спеки "
                    "(например .../v3/api-docs) или вставьте содержимое вручную."
                ),
            )
    except httpx.ConnectError as exc:
        if "CERTIFICATE_VERIFY_FAILED" in str(exc):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Ошибка TLS при загрузке {req.url}: самоподписанный/корпоративный сертификат. "
                    "Задайте ANALYZER_CA_BUNDLE (путь к корпоративному CA) или "
                    "ANALYZER_VERIFY_SSL=false для отладки."
                ),
            ) from exc
        raise HTTPException(status_code=400, detail=f"Не удалось подключиться к {req.url}: {exc}") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=400, detail=f"Не удалось загрузить {req.url}: {exc}") from exc


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
