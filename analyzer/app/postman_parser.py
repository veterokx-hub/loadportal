"""Детерминированный парсер Postman Collection v2.x -> ScenarioDraft."""
from __future__ import annotations

import json
from typing import Any, Optional
from urllib.parse import urlsplit

from .models import (
    Body,
    BodyMode,
    ConstantSource,
    HttpMethod,
    KeyValue,
    Param,
    ParamLocation,
    Request,
    ScenarioDraft,
    SourceType,
)


def parse_postman(content: str, name: Optional[str] = None) -> ScenarioDraft:
    doc = json.loads(content)
    info = doc.get("info", {})
    title = name or info.get("name") or "postman-scenario"

    items: list[dict[str, Any]] = []
    _flatten(doc.get("item", []), items)

    base_url = ""
    requests: list[Request] = []
    for order, item in enumerate(items, start=1):
        req = _build_request(order, item)
        if req is None:
            continue
        if not base_url and req.path.startswith("/") is False:
            pass
        requests.append(req)

    base_url = _common_base_url(items)
    # если нашли общий base_url — сделаем path относительным
    if base_url:
        for r in requests:
            if r.path.startswith(base_url):
                r.path = r.path[len(base_url):] or "/"

    return ScenarioDraft(
        name=title,
        source_type=SourceType.POSTMAN,
        base_url=base_url,
        requests=requests,
    )


def _flatten(items: list[dict[str, Any]], out: list[dict[str, Any]]) -> None:
    for item in items:
        if "item" in item:  # это папка
            _flatten(item["item"], out)
        elif "request" in item:
            out.append(item)


def _raw_url(request: dict[str, Any]) -> str:
    url = request.get("url")
    if isinstance(url, str):
        return url
    if isinstance(url, dict):
        if url.get("raw"):
            return url["raw"]
        host = ".".join(url.get("host", [])) if isinstance(url.get("host"), list) else url.get("host", "")
        path = "/".join(url.get("path", [])) if isinstance(url.get("path"), list) else url.get("path", "")
        proto = url.get("protocol", "https")
        return f"{proto}://{host}/{path}"
    return ""


def _build_request(order: int, item: dict[str, Any]) -> Optional[Request]:
    request = item.get("request")
    if not isinstance(request, dict):
        return None
    method = str(request.get("method", "GET")).upper()
    raw_url = _raw_url(request)
    split = urlsplit(raw_url)
    path = split.path or "/"
    name = item.get("name") or f"{method} {path}"

    headers: list[KeyValue] = []
    params: list[Param] = []
    for h in request.get("header", []):
        if h.get("disabled"):
            continue
        params.append(Param(
            name=h.get("key", ""), location=ParamLocation.HEADER,
            source=ConstantSource(value=h.get("value", "")),
        ))

    query_params: list[Param] = []
    url = request.get("url")
    if isinstance(url, dict):
        for q in url.get("query", []) or []:
            if q.get("disabled"):
                continue
            p = Param(
                name=q.get("key", ""), location=ParamLocation.QUERY,
                source=ConstantSource(value=q.get("value", "") or ""),
            )
            query_params.append(p)
            params.append(p)

    body = _build_body(request.get("body"))

    return Request(
        id=f"{_slug(name)}_{order}",
        order=order,
        name=name,
        method=method if method in HttpMethod._value2member_map_ else method,
        path=path,
        headers=headers,
        query_params=query_params,
        body=body,
        params=params,
        extractions=[],
    )


def _build_body(body: Optional[dict[str, Any]]) -> Body:
    if not body:
        return Body(mode=BodyMode.NONE)
    mode = body.get("mode")
    if mode == "raw":
        raw = body.get("raw", "")
        options = (body.get("options") or {}).get("raw", {})
        lang = options.get("language", "")
        if lang == "json" or raw.strip().startswith(("{", "[")):
            return Body(mode=BodyMode.JSON, content_type="application/json", content=raw)
        return Body(mode=BodyMode.RAW, content=raw)
    if mode == "urlencoded":
        pairs = body.get("urlencoded", [])
        content = "&".join(f"{p.get('key')}={p.get('value','')}" for p in pairs if not p.get("disabled"))
        return Body(mode=BodyMode.FORM, content_type="application/x-www-form-urlencoded", content=content)
    return Body(mode=BodyMode.NONE)


def _common_base_url(items: list[dict[str, Any]]) -> str:
    urls = []
    for item in items:
        request = item.get("request")
        if isinstance(request, dict):
            split = urlsplit(_raw_url(request))
            if split.scheme and split.netloc:
                urls.append(f"{split.scheme}://{split.netloc}")
    if urls and len(set(urls)) == 1:
        return urls[0]
    return ""


def _slug(text: str) -> str:
    out = "".join(c if c.isalnum() else "_" for c in text)
    return out.strip("_").lower() or "req"
