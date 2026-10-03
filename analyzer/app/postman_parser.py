"""Детерминированный парсер Postman Collection v2.x -> ScenarioDraft."""
from __future__ import annotations

import json
import re
from typing import Any, Optional
from urllib.parse import urlsplit

from .models import (
    Body,
    BodyMode,
    ConstantSource,
    HttpMethod,
    Param,
    ParamLocation,
    Request,
    ScenarioDraft,
    SourceType,
)

_HTTP_METHODS = {m.value for m in HttpMethod}
_PLACEHOLDER_RE = re.compile(r"\{\{([a-zA-Z0-9_]+)\}\}")
_BRACE_RE = re.compile(r"\{([a-zA-Z0-9_]+)\}")
_COLON_RE = re.compile(r":([a-zA-Z][a-zA-Z0-9_]*)")


def parse_postman(content: str, name: Optional[str] = None) -> ScenarioDraft:
    doc = json.loads(content)
    info = doc.get("info", {})
    title = name or info.get("name") or "postman-scenario"
    variables = _collect_variables(doc)

    items: list[dict[str, Any]] = []
    _flatten(doc.get("item", []), items)

    parsed: list[tuple[Request, str]] = []
    for order, item in enumerate(items, start=1):
        built = _build_request(order, item, variables)
        if built is None:
            continue
        parsed.append(built)

    bases = [b for _, b in parsed if b]
    base_url = ""
    if bases and len(set(bases)) == 1:
        base_url = bases[0]

    requests: list[Request] = []
    for req, base in parsed:
        if base and base_url and base != base_url:
            req.url = base + (req.path if req.path.startswith("/") else "/" + req.path)
        requests.append(req)

    return ScenarioDraft(
        name=title,
        source_type=SourceType.POSTMAN,
        base_url=base_url,
        requests=requests,
    )


def _flatten(items: list[dict[str, Any]], out: list[dict[str, Any]], folder_vars: Optional[dict[str, str]] = None) -> None:
    folder_vars = dict(folder_vars or {})
    for item in items:
        local = dict(folder_vars)
        local.update(_vars_from_list(item.get("variable")))
        if "item" in item:
            _flatten(item["item"], out, local)
        elif "request" in item:
            cloned = dict(item)
            cloned["_folder_vars"] = local
            out.append(cloned)


def _collect_variables(doc: dict[str, Any]) -> dict[str, str]:
    out = _vars_from_list(doc.get("variable"))
    for v in (doc.get("info") or {}).get("variable") or []:
        if isinstance(v, dict) and v.get("key"):
            out.setdefault(str(v["key"]), str(v.get("value") or ""))
    return out


def _vars_from_list(items: Any) -> dict[str, str]:
    out: dict[str, str] = {}
    if not isinstance(items, list):
        return out
    for v in items:
        if isinstance(v, dict) and v.get("key"):
            out[str(v["key"])] = str(v.get("value") or "")
    return out


def _sub(text: str, variables: dict[str, str]) -> str:
    if not text:
        return text

    def repl(m: re.Match[str]) -> str:
        return variables.get(m.group(1), m.group(0))

    return _PLACEHOLDER_RE.sub(repl, text)


def _to_portal_placeholders(text: str) -> str:
    """{{name}} и :name → {name}, не трогая уже готовые {name}."""
    if not text:
        return text
    text = _PLACEHOLDER_RE.sub(r"{\1}", text)
    text = _COLON_RE.sub(r"{\1}", text)
    return text


def _join_host(host: Any) -> str:
    if isinstance(host, list):
        parts = [str(p).strip() for p in host if str(p).strip()]
        return ".".join(parts)
    return str(host or "").strip()


def _path_segments(path: Any) -> list[str]:
    if path is None:
        return []
    if isinstance(path, str):
        return [s for s in path.split("/") if s != ""]
    if not isinstance(path, list):
        return []
    segs: list[str] = []
    for p in path:
        if isinstance(p, dict):
            val = str(p.get("value") or p.get("key") or "")
        else:
            val = str(p)
        if val != "":
            segs.append(val)
    return segs


def _build_request(
    order: int, item: dict[str, Any], collection_vars: dict[str, str]
) -> Optional[tuple[Request, str]]:
    request = item.get("request")
    if isinstance(request, str):
        # иногда request — это curl-строка
        return None
    if not isinstance(request, dict):
        return None

    variables = dict(collection_vars)
    variables.update(item.get("_folder_vars") or {})

    method = str(request.get("method", "GET")).upper()
    if method not in _HTTP_METHODS:
        method = "GET"

    base, path, path_params = _parse_url(request.get("url"), variables, item.get("name") or "")

    name = _request_name(item.get("name"), method, path)

    params: list[Param] = []
    seen: set[str] = set()
    for p in path_params:
        key = f"path:{p.name}"
        if key in seen:
            continue
        seen.add(key)
        params.append(p)

    for h in request.get("header", []) or []:
        if not isinstance(h, dict) or h.get("disabled"):
            continue
        key = str(h.get("key") or "")
        if not key:
            continue
        params.append(Param(
            name=key,
            location=ParamLocation.HEADER,
            source=ConstantSource(value=str(h.get("value") or "")),
        ))

    query_params: list[Param] = []
    url = request.get("url")
    if isinstance(url, dict):
        for q in url.get("query", []) or []:
            if not isinstance(q, dict) or q.get("disabled"):
                continue
            qname = str(q.get("key") or "")
            if not qname:
                continue
            p = Param(
                name=qname,
                location=ParamLocation.QUERY,
                source=ConstantSource(value=_to_portal_placeholders(str(q.get("value") or ""))),
            )
            query_params.append(p)
            params.append(p)

    body = _build_body(request.get("body"))
    body_content = _to_portal_placeholders(body.content)
    body = body.model_copy(update={"content": body_content}) if body_content != body.content else body
    for n in _BRACE_RE.findall(body.content):
        key = f"body:{n}"
        if key in seen:
            continue
        seen.add(key)
        quoted = ('"{' + n + '}"') in body.content
        params.append(Param(
            name=n,
            location=ParamLocation.BODY,
            source=ConstantSource(value=""),
            required=True,
            quoted=quoted,
        ))

    req = Request(
        id=f"{_slug(name)}_{order}",
        order=order,
        name=name,
        method=method,
        path=path or "/",
        url=None,
        headers=[],
        query_params=query_params,
        body=body,
        params=params,
        extractions=[],
    )
    return req, base


def _request_name(raw_name: Any, method: str, path: str) -> str:
    name = str(raw_name or "").strip()
    low = name.lower()
    if not name or low.startswith("curl ") or low.startswith("curl\t") or "curl -" in low:
        return f"{method} {path}"
    return name


def _parse_url(
    url: Any, variables: dict[str, str], item_name: str
) -> tuple[str, str, list[Param]]:
    proto, host, port, segs, path_vars = _url_fields(url)

    proto = _sub(proto, variables).strip(":/") or "http"
    host_raw = _sub(host, variables)
    port = _sub(port, variables).strip()

    extra_path: list[str] = []
    if host_raw.startswith("http://") or host_raw.startswith("https://"):
        sp = urlsplit(host_raw)
        proto = sp.scheme or proto
        host_raw = sp.hostname or ""
        if sp.port:
            port = str(sp.port)
        if sp.path and sp.path not in ("", "/"):
            extra_path = [s for s in sp.path.split("/") if s]

    host = host_raw.strip().strip("/")
    # host мог прийти как "localhost:8080"
    if ":" in host and host.count(":") == 1 and not host.startswith("["):
        h, maybe_port = host.rsplit(":", 1)
        if maybe_port.isdigit():
            host = h
            port = port or maybe_port

    base = ""
    if host:
        base = f"{proto}://{host}"
        if port and not (proto == "http" and port == "80") and not (proto == "https" and port == "443"):
            if ":" not in host:
                base = f"{proto}://{host}:{port}"

    segs = extra_path + segs
    segs = [_to_portal_placeholders(s) for s in segs if s not in ("", "/")]
    if segs and segs[0].upper() in _HTTP_METHODS:
        segs = segs[1:]
    # порт/хост, ошибочно попавшие в path
    if segs and segs[0].isdigit() and len(segs[0]) >= 2:
        segs = segs[1:]
    if segs and segs[0].lower() in {"localhost", "127.0.0.1"}:
        segs = segs[1:]

    params: list[Param] = []
    for v in path_vars:
        key = str(v.get("key") or "").strip()
        if not key:
            continue
        val = str(v.get("value") or "")
        params.append(Param(
            name=key,
            location=ParamLocation.PATH,
            source=ConstantSource(value=val),
            example=val or None,
            required=True,
        ))
        segs = _replace_seg_value(segs, key, val)

    for n in _names_in_text(item_name):
        segs = _replace_seg_value(segs, n, None)
        if not any(p.name == n and p.location == ParamLocation.PATH for p in params):
            if any("{" + n + "}" in s for s in segs):
                params.append(Param(
                    name=n,
                    location=ParamLocation.PATH,
                    source=ConstantSource(value=""),
                    required=True,
                ))

    path = "/" + "/".join(segs) if segs else "/"
    path = _to_portal_placeholders(path)
    if not path.startswith("/"):
        path = "/" + path

    for n in _BRACE_RE.findall(path):
        if not any(p.name == n and p.location == ParamLocation.PATH for p in params):
            params.append(Param(
                name=n,
                location=ParamLocation.PATH,
                source=ConstantSource(value=""),
                required=True,
            ))

    return base, path, params


def _replace_seg_value(segs: list[str], key: str, value: Optional[str]) -> list[str]:
    token = "{" + key + "}"
    out: list[str] = []
    for s in segs:
        if s in {":" + key, "{{" + key + "}}", token}:
            out.append(token)
        elif value and s == value:
            out.append(token)
        else:
            out.append(s)
    return out


def _names_in_text(text: str) -> list[str]:
    names: list[str] = []
    for n in _BRACE_RE.findall(text or ""):
        if n not in names:
            names.append(n)
    for n in _PLACEHOLDER_RE.findall(text or ""):
        if n not in names:
            names.append(n)
    return names


def _url_fields(url: Any) -> tuple[str, str, str, list[str], list[dict[str, Any]]]:
    proto, host, port = "http", "", ""
    segs: list[str] = []
    path_vars: list[dict[str, Any]] = []
    if isinstance(url, str):
        repaired = _repair_raw(url)
        sp = urlsplit(repaired)
        proto = sp.scheme or proto
        host = sp.hostname or ""
        port = str(sp.port) if sp.port else ""
        segs = [s for s in (sp.path or "").split("/") if s]
        return proto, host, port, segs, path_vars
    if not isinstance(url, dict):
        return proto, host, port, segs, path_vars

    proto = str(url.get("protocol") or proto)
    host = _join_host(url.get("host"))
    port = str(url.get("port") or "")
    segs = _path_segments(url.get("path"))
    path_vars = [v for v in (url.get("variable") or []) if isinstance(v, dict)]

    # structured host/path важнее raw: raw часто без scheme → порт уезжает в path
    if not host:
        raw = _repair_raw(str(url.get("raw") or ""))
        if raw:
            sp = urlsplit(raw)
            proto = sp.scheme or proto
            host = sp.hostname or host
            if sp.port:
                port = str(sp.port)
            if not segs:
                segs = [s for s in (sp.path or "").split("/") if s]
    return proto, host, port, segs, path_vars


def _repair_raw(raw: str) -> str:
    raw = (raw or "").strip()
    if not raw:
        return ""
    if "://" not in raw:
        if raw.startswith("//"):
            return "http:" + raw
        return "http://" + raw
    return raw


def _build_body(body: Optional[dict[str, Any]]) -> Body:
    if not body:
        return Body(mode=BodyMode.NONE)
    mode = body.get("mode")
    if mode == "raw":
        raw = str(body.get("raw") or "")
        options = (body.get("options") or {}).get("raw", {})
        lang = options.get("language", "") if isinstance(options, dict) else ""
        if lang == "json" or raw.strip().startswith(("{", "[")):
            return Body(mode=BodyMode.JSON, content_type="application/json", content=raw)
        return Body(mode=BodyMode.RAW, content=raw)
    if mode == "urlencoded":
        pairs = body.get("urlencoded", []) or []
        content = "&".join(
            f"{p.get('key')}={p.get('value', '')}"
            for p in pairs if isinstance(p, dict) and not p.get("disabled")
        )
        return Body(mode=BodyMode.FORM, content_type="application/x-www-form-urlencoded", content=content)
    return Body(mode=BodyMode.NONE)


def _slug(text: str) -> str:
    out = "".join(c if c.isalnum() else "_" for c in text)
    return out.strip("_").lower() or "req"
