"""Детерминированный парсер OpenAPI 2/3 -> ScenarioDraft.

Без ИИ. Извлекает операции, параметры (path/query/header), тело запроса
(генерирует пример из схемы) и предлагает базовые стратегии заполнения.
ИИ-слой позже сможет переупорядочить запросы и предложить корреляции.
"""
from __future__ import annotations

import json
from typing import Any, Optional

from .models import (
    Body,
    BodyMode,
    ConstantSource,
    GeneratorSource,
    Generator,
    GeneratorType,
    HttpMethod,
    KeyValue,
    Param,
    ParamLocation,
    Request,
    ScenarioDraft,
    SourceType,
    Validation,
)

_HTTP_METHODS = {"get", "put", "post", "delete", "patch", "head", "options"}


def _load(content: str) -> dict[str, Any]:
    text = content.strip()
    if text.startswith("{"):
        return json.loads(text)
    try:
        import yaml  # type: ignore
    except ImportError as exc:  # pragma: no cover
        raise ValueError("Для YAML-спеки нужен пакет pyyaml") from exc
    return yaml.safe_load(text)


class _RefResolver:
    """Разрешает локальные $ref внутри одного документа."""

    def __init__(self, root: dict[str, Any]):
        self.root = root

    def resolve(self, node: Any, _seen: Optional[set[str]] = None) -> Any:
        if isinstance(node, dict) and "$ref" in node:
            ref = node["$ref"]
            _seen = _seen or set()
            if ref in _seen:  # защита от циклов
                return {}
            _seen = _seen | {ref}
            target = self._deref(ref)
            return self.resolve(target, _seen)
        return node

    def _deref(self, ref: str) -> Any:
        if not ref.startswith("#/"):
            return {}
        cur: Any = self.root
        for part in ref[2:].split("/"):
            part = part.replace("~1", "/").replace("~0", "~")
            if isinstance(cur, dict) and part in cur:
                cur = cur[part]
            else:
                return {}
        return cur


def _example_from_schema(schema: dict[str, Any], resolver: _RefResolver, depth: int = 0) -> Any:
    schema = resolver.resolve(schema) or {}
    if depth > 6:
        return None
    if "example" in schema:
        return schema["example"]
    if "default" in schema:
        return schema["default"]
    if "enum" in schema and schema["enum"]:
        return schema["enum"][0]

    t = schema.get("type")
    if t is None and "properties" in schema:
        t = "object"

    if t == "object":
        result: dict[str, Any] = {}
        for prop, prop_schema in (schema.get("properties") or {}).items():
            result[prop] = _example_from_schema(prop_schema, resolver, depth + 1)
        return result
    if t == "array":
        item = _example_from_schema(schema.get("items") or {}, resolver, depth + 1)
        return [item]
    if t == "integer":
        return 0
    if t == "number":
        return 0.0
    if t == "boolean":
        return False
    if t == "string":
        fmt = schema.get("format")
        if fmt == "date-time":
            return "2020-01-01T00:00:00Z"
        if fmt == "uuid":
            return "00000000-0000-0000-0000-000000000000"
        return "string"
    return None


def _param_source_for(schema: dict[str, Any], name: str) -> Any:
    """Базовая эвристика стратегии заполнения (детерминированная)."""
    fmt = (schema or {}).get("format")
    lname = name.lower()
    if fmt == "uuid" or lname.endswith("id") and (schema or {}).get("type") == "string":
        return GeneratorSource(generator=Generator(type=GeneratorType.UUID))
    if (schema or {}).get("type") in ("integer", "number"):
        return GeneratorSource(generator=Generator(type=GeneratorType.RANDOM_INT, min=1, max=1000))
    return ConstantSource(value=str(_example_from_schema(schema or {}, _RefResolver({})) or ""))


def parse_openapi(content: str, name: Optional[str] = None) -> ScenarioDraft:
    doc = _load(content)
    resolver = _RefResolver(doc)

    base_url = _extract_base_url(doc)
    title = name or doc.get("info", {}).get("title") or "openapi-scenario"

    requests: list[Request] = []
    order = 0
    paths = doc.get("paths") or {}
    for path, path_item in paths.items():
        if not isinstance(path_item, dict):
            continue
        common_params = path_item.get("parameters", [])
        for method, op in path_item.items():
            if method.lower() not in _HTTP_METHODS or not isinstance(op, dict):
                continue
            order += 1
            req = _build_request(
                order, method.upper(), path, op, common_params, resolver
            )
            requests.append(req)

    return ScenarioDraft(
        name=title,
        source_type=SourceType.OPENAPI,
        base_url=base_url,
        requests=requests,
    )


def _extract_base_url(doc: dict[str, Any]) -> str:
    servers = doc.get("servers")
    if servers and isinstance(servers, list) and servers[0].get("url"):
        return str(servers[0]["url"]).rstrip("/")
    host = doc.get("host")
    if host:  # swagger 2
        scheme = (doc.get("schemes") or ["https"])[0]
        base = doc.get("basePath", "")
        return f"{scheme}://{host}{base}".rstrip("/")
    return ""


def _build_request(
    order: int,
    method: str,
    path: str,
    op: dict[str, Any],
    common_params: list[dict[str, Any]],
    resolver: _RefResolver,
) -> Request:
    op_id = op.get("operationId") or f"{method.lower()}_{path}"
    name = f"{method} {path}"

    headers: list[KeyValue] = []
    query_params: list[Param] = []
    params: list[Param] = []

    all_params = [resolver.resolve(p) for p in (common_params + op.get("parameters", []))]
    for p in all_params:
        if not isinstance(p, dict):
            continue
        loc = p.get("in")
        pname = p.get("name", "")
        schema = resolver.resolve(p.get("schema", {})) or {}
        source = _param_source_for(schema, pname)
        if loc == "query":
            param = Param(
                name=pname, location=ParamLocation.QUERY, source=source,
                schema_type=schema.get("type"), required=bool(p.get("required")),
            )
            query_params.append(param)
            params.append(param)
        elif loc == "path":
            params.append(Param(
                name=pname, location=ParamLocation.PATH, source=source,
                schema_type=schema.get("type"), required=True,
            ))
        elif loc == "header":
            params.append(Param(
                name=pname, location=ParamLocation.HEADER, source=source,
                schema_type=schema.get("type"), required=bool(p.get("required")),
            ))

    body = _build_body(op, resolver)
    if body.content_type and not any(
        p.name == "Content-Type" and p.location == ParamLocation.HEADER for p in params
    ):
        params.append(Param(
            name="Content-Type", location=ParamLocation.HEADER,
            source=ConstantSource(value=body.content_type), required=False,
        ))
    validation = _build_validation(op, resolver)

    return Request(
        id=_slug(op_id),
        order=order,
        name=name,
        method=method.upper(),
        path=path,
        headers=headers,
        query_params=query_params,
        body=body,
        params=params,
        extractions=[],
        validation=validation,
    )


def _build_validation(op: dict[str, Any], resolver: _RefResolver) -> Validation:
    """Определяет ожидаемый success-код и простую подстроку (Contains) —
    имя первого top-level поля JSON-ответа."""
    responses = op.get("responses") or {}
    status = 200
    success_key = None
    for code in responses:
        if isinstance(code, str) and code.startswith("2"):
            success_key = code
            try:
                status = int(code)
            except ValueError:
                status = 200
            break
    contains = ""
    if success_key is not None:
        resp = resolver.resolve(responses[success_key]) or {}
        content = resp.get("content") or {}
        json_ct = content.get("application/json")
        if json_ct:
            schema = json_ct.get("schema", {})
            names = _collect_field_names(schema, resolver)
            if names:
                # простая проверка наличия имени первого поля в теле ответа
                contains = f'"{names[0]}"'
    return Validation(check_response_code=True, expected_status=status, response_contains=contains)


def _collect_field_names(schema: dict[str, Any], resolver: _RefResolver,
                         depth: int = 0, acc: Optional[list[str]] = None,
                         seen: Optional[set[int]] = None) -> list[str]:
    if acc is None:
        acc = []
    if seen is None:
        seen = set()
    schema = resolver.resolve(schema) or {}
    if depth > 6:
        return acc
    props = schema.get("properties")
    if isinstance(props, dict):
        for name, sub in props.items():
            if name not in acc:
                acc.append(name)
            _collect_field_names(sub, resolver, depth + 1, acc, seen)
    items = schema.get("items")
    if items is not None:
        _collect_field_names(items, resolver, depth + 1, acc, seen)
    return acc


def re_escape(s: str) -> str:
    import re
    return re.escape(s)


def _build_body(op: dict[str, Any], resolver: _RefResolver) -> Body:
    request_body = resolver.resolve(op.get("requestBody", {})) or {}
    content = request_body.get("content") or {}
    if "application/json" in content:
        schema = content["application/json"].get("schema", {})
        example = _example_from_schema(schema, resolver)
        return Body(
            mode=BodyMode.JSON,
            content_type="application/json",
            content=json.dumps(example, ensure_ascii=False, indent=2),
        )
    for ct in content:
        return Body(mode=BodyMode.RAW, content_type=ct, content="")
    return Body(mode=BodyMode.NONE)


def _slug(text: str) -> str:
    out = "".join(c if c.isalnum() else "_" for c in text)
    return out.strip("_").lower() or "req"
