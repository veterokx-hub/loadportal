"""Генерация k6-скрипта (JavaScript) из доменной модели Scenario.

Соответствие семантике JMeter-сборки (JmxBuilder):
 - каждая ГРУППА (union-find по корреляции ${var} и общему dataset_id) = отдельный
   k6-scenario с исполнителем ramping-arrival-rate (open-model, по RPS);
 - профиль интенсивности группы (ramp-up → удержание, либо лестница поиска
   максимума) переносится в stages;
 - repeat запроса = цикл внутри exec-функции;
 - корреляция (json/regex/boundary) кладётся в объект vars и подставляется дальше;
 - валидация (код ответа, contains) = check();
 - AutoStop = thresholds с abortOnFail;
 - датасеты = SharedArray (инлайн для небольших, внешний CSV для больших — гибрид).

Модель нагрузки RPS ⇒ preAllocatedVUs/maxVUs считаем по закону Литтла
(rps × assumed_latency × запас).
"""
from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field

from enum import Enum
from typing import Any

from .models import (
    Dataset,
    GeneratorType,
    ParamLocation,
    Request,
    ScenarioDraft,
    TestMode,
)

VAR_RE = re.compile(r"\$\{([a-zA-Z0-9_]+)\}")
INLINE_ROW_LIMIT = 2000  # больше — выносим CSV во внешний файл
CONCURRENCY_SAFETY = 1.5


def _enum_str(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, Enum):
        return str(v.value)
    return str(v)


def _constant_text(source: Any) -> str:
    if isinstance(source, str):
        return source
    if isinstance(source, dict):
        return str(source.get("value") or "")
    if _param_source_kind(source) == "constant":
        return getattr(source, "value", "") or ""
    return ""


def _param_source_kind(source: Any) -> str:
    if isinstance(source, dict):
        return str(source.get("kind") or "constant")
    return str(getattr(source, "kind", "constant"))


def _correlation_var(source: Any) -> str:
    if isinstance(source, dict):
        return str(source.get("variable") or "")
    return str(getattr(source, "variable", "") or "")


def _csv_column(source: Any) -> str:
    if isinstance(source, dict):
        return str(source.get("column") or "")
    return str(getattr(source, "column", "") or "")


def _generator_obj(source: Any):
    if isinstance(source, dict):
        return source.get("generator")
    return getattr(source, "generator", None)


@dataclass
class GeneratedFile:
    name: str
    content: str


@dataclass
class K6Result:
    filename: str  # базовое имя без расширения
    script: str
    data_files: list[GeneratedFile] = field(default_factory=list)

    @property
    def is_zip(self) -> bool:
        return len(self.data_files) > 0


# --- Группировка (зеркало ScenarioGrouping.java) ------------------------------------

def _referenced_vars(req: Request) -> set[str]:
    vars_: set[str] = set()
    for h in req.headers:
        vars_ |= set(VAR_RE.findall(h.value or ""))
    for p in req.params:
        kind = _param_source_kind(p.source)
        if kind == "correlation":
            vars_.add(_correlation_var(p.source))
        elif kind == "constant":
            vars_ |= set(VAR_RE.findall(_constant_text(p.source) or ""))
    if req.body:
        vars_ |= set(VAR_RE.findall(req.body.content or ""))
    vars_ |= set(VAR_RE.findall(req.path or ""))
    vars_ |= set(VAR_RE.findall(req.url or ""))
    return vars_


def _group(scenario: ScenarioDraft) -> list[tuple[list[Request], list[str]]]:
    reqs = sorted(scenario.requests, key=lambda r: r.order)
    n = len(reqs)
    if n == 0:
        return []

    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    var_owner: dict[str, int] = {}
    for i, r in enumerate(reqs):
        for ex in r.extractions:
            if ex.variable:
                var_owner[ex.variable] = i

    for i, r in enumerate(reqs):
        for v in _referenced_vars(r):
            owner = var_owner.get(v)
            if owner is not None and owner != i:
                union(owner, i)

    first_ds: dict[str, int] = {}
    for i, r in enumerate(reqs):
        if r.dataset_id:
            first = first_ds.setdefault(r.dataset_id, i)
            if first != i:
                union(first, i)

    comps: dict[int, list[Request]] = {}
    for i, r in enumerate(reqs):
        comps.setdefault(find(i), []).append(r)

    groups: list[tuple[list[Request], list[str]]] = []
    for members in comps.values():
        members.sort(key=lambda r: r.order)
        ds_ids: list[str] = []
        for m in members:
            if m.dataset_id and m.dataset_id not in ds_ids:
                ds_ids.append(m.dataset_id)
        groups.append((members, ds_ids))
    groups.sort(key=lambda g: g[0][0].order)
    return groups


# --- Профиль нагрузки -> stages -----------------------------------------------------

def _rate(v: float) -> float | int:
    """k6 arrival-rate: сохраняем дробные RPS (0.01), целые без хвоста .0."""
    r = round(float(v), 6)
    if r == int(r):
        return int(r)
    return r


def _stages(intensity, load) -> tuple[float | int, list[dict]]:
    target = max(0.0, intensity.target_rps)
    if load.test_mode == TestMode.MAX_SEARCH:
        steps = max(1, load.steps)
        dur = max(1, load.step_duration_sec)
        stages: list[dict] = []
        for i in range(1, steps + 1):
            level = _rate(target * i / steps)
            trans = max(1, dur // 10)
            stages.append({"target": level, "duration": f"{trans}s"})
            stages.append({"target": level, "duration": f"{max(1, dur - trans)}s"})
        return 0, stages
    r = _rate(target)
    stages = []
    if intensity.ramp_up_sec > 0:
        start: float | int = 0
        stages.append({"target": r, "duration": f"{intensity.ramp_up_sec}s"})
    else:
        start = r
    stages.append({"target": r, "duration": f"{max(1, intensity.hold_sec)}s"})
    return start, stages


def _vu_sizing(peak_rps: float, latency: float) -> tuple[int, int]:
    lat = max(0.05, latency)
    pre = max(1, math.ceil(peak_rps * lat))
    mx = max(pre, math.ceil(peak_rps * lat * CONCURRENCY_SAFETY))
    return pre, mx


# --- Значения параметров -> JS-выражения --------------------------------------------

def _gen_expr(g) -> str:
    t = g.type
    if t == GeneratorType.UUID:
        return "uuidv4()"
    if t == GeneratorType.RANDOM_INT:
        return f"String(randomIntBetween({g.min if g.min is not None else 0}, {g.max if g.max is not None else 1000000}))"
    if t == GeneratorType.RANDOM_STRING:
        chars = json.dumps(g.chars) if g.chars else "undefined"
        return f"randomString({g.length if g.length is not None else 8}, {chars})"
    if t == GeneratorType.COUNTER:
        return "String(nextCounter())"
    if t == GeneratorType.TIMESTAMP:
        return f"tsFormat({json.dumps(g.format or '')})"
    return "''"


def _param_expr(p) -> str:
    s = p.source
    kind = _param_source_kind(s)
    if kind == "generator":
        gen = _generator_obj(s)
        return _gen_expr(gen) if gen is not None else "''"
    if kind == "correlation":
        return f"(vars[{json.dumps(_correlation_var(s))}] ?? '')"
    if kind == "csv":
        return f"(row[{json.dumps(_csv_column(s))}] ?? '')"
    return f"interp({json.dumps(_constant_text(s))}, vars, row)"


# --- Рендер exec-функции группы -----------------------------------------------------

def _emit_request(req: Request) -> list[str]:
    L: list[str] = []
    ind = "    "
    path_params = [p for p in req.params if p.location == ParamLocation.PATH]
    query_params = [p for p in req.params if p.location == ParamLocation.QUERY]
    header_params = [p for p in req.params if p.location == ParamLocation.HEADER]

    body_has = (
        req.body is not None
        and _enum_str(req.body.mode) != "none"
        and (req.body.content or "") != ""
    )

    repeat = max(1, req.repeat)
    open_loop = repeat > 1
    base_ind = ind
    if open_loop:
        L.append(f"{ind}for (let _i = 0; _i < {repeat}; _i++) {{")
        base_ind = ind + "  "

    L.append(f"{base_ind}{{")
    b = base_ind + "  "
    L.append(f"{b}// {_enum_str(req.method)} {req.name}")
    custom_url = (req.url or "").strip()
    L.append(f"{b}let path = {json.dumps(custom_url or req.path or '/')};")
    for p in path_params:
        L.append(
            f"{b}path = replaceBrace(path, {json.dumps(p.name)}, encodeURIComponent(String({_param_expr(p)})));"
        )
    L.append(f"{b}path = interp(path, vars, row);")

    L.append(f"{b}const _q = [];")
    for qp in query_params:
        L.append(f"{b}_q.push([{json.dumps(qp.name)}, {_param_expr(qp)}]);")
    L.append(
        f"{b}const _qs = _q.length ? '?' + _q.map(([k, v]) => k + '=' + encodeURIComponent(String(v))).join('&') : '';"
    )
    if custom_url:
        # собственный абсолютный URL запроса — BASE_URL не используется
        L.append(f"{b}const url = path + _qs;")
    else:
        L.append(f"{b}const url = joinUrl(BASE_URL, path) + _qs;")

    L.append(f"{b}const headers = {{}};")
    for h in req.headers:
        if not h.key:
            continue
        L.append(f"{b}headers[{json.dumps(h.key)}] = interp({json.dumps(h.value or '')}, vars, row);")
    for hp in header_params:
        L.append(f"{b}headers[{json.dumps(hp.name)}] = String({_param_expr(hp)});")

    if body_has:
        content = req.body.content
        body_params = [
            p
            for p in req.params
            if p.location == ParamLocation.BODY and ("{" + p.name + "}") in (content or "")
        ]
        if body_params:
            L.append(f"{b}let bodyTpl = {json.dumps(content)};")
            for p in body_params:
                L.append(
                    f"{b}bodyTpl = replaceBrace(bodyTpl, {json.dumps(p.name)}, String({_param_expr(p)}));"
                )
            L.append(f"{b}const body = interp(bodyTpl, vars, row);")
        else:
            L.append(f"{b}const body = interp({json.dumps(content)}, vars, row);")
        if req.body.content_type:
            L.append(
                f"{b}if (!headers['Content-Type']) headers['Content-Type'] = {json.dumps(req.body.content_type)};"
            )
    else:
        L.append(f"{b}const body = null;")

    L.append(f"{b}res = http.request({json.dumps(_enum_str(req.method))}, url, body, {{ headers }});")

    checks: list[str] = []
    v = req.validation
    if v.check_response_code:
        checks.append(f"{json.dumps('status is ' + str(v.expected_status))}: (r) => r.status === {v.expected_status}")
    if v.response_contains:
        checks.append(
            f"{json.dumps('body contains ' + v.response_contains)}: (r) => !!r.body && String(r.body).includes({json.dumps(v.response_contains)})"
        )
    if checks:
        L.append(f"{b}check(res, {{ {', '.join(checks)} }});")

    for ex in req.extractions:
        var = json.dumps(ex.variable)
        dv = json.dumps(ex.default_value)
        ex_type = _enum_str(ex.type)
        if ex_type == "json":
            L.append(f"{b}vars[{var}] = jsonPath(safeJson(res), {json.dumps(ex.expression)}, {dv});")
        elif ex_type == "regex":
            L.append(f"{b}vars[{var}] = extractRegex(res.body, {json.dumps(ex.expression)}, {ex.match_no}, {dv});")
        elif ex_type == "boundary":
            parts = (ex.expression or "").split("|", 1)
            left = json.dumps(parts[0] if parts else "")
            right = json.dumps(parts[1] if len(parts) > 1 else "")
            L.append(f"{b}vars[{var}] = extractBoundary(res.body, {left}, {right}, {dv});")

    L.append(f"{base_ind}}}")
    if open_loop:
        L.append(f"{ind}}}")
    return L


def _emit_exec(key: str, members: list[Request], ds_ids: list[str], datasets: dict[str, Dataset]) -> str:
    L: list[str] = []
    L.append(f"export function {key}() {{")
    L.append("  const vars = {};")
    L.append("  let res;")
    if ds_ids:
        L.append("  let row = {};")
        for dsid in ds_ids:
            ds = datasets.get(dsid)
            if ds is None:
                continue
            arr = f"ds_{_js_id(dsid)}"
            pick = (
                f"{arr}[Math.floor(Math.random() * {arr}.length)]"
                if ds.random
                else f"{arr}[_scn.iterationInTest % {arr}.length]"
            )
            L.append(f"  if ({arr}.length) Object.assign(row, {pick});")
    else:
        L.append("  const row = {};")
    for req in members:
        L.extend(_emit_request(req))
    L.append("}")
    return "\n".join(L)


# --- Датасеты -----------------------------------------------------------------------

def _js_id(s: str) -> str:
    out = re.sub(r"[^a-zA-Z0-9_]", "_", s)
    return out or "ds"


def _dataset_decl(ds: Dataset) -> tuple[str, GeneratedFile | None]:
    """Возвращает (js-объявление SharedArray, внешний файл|None)."""
    name = _js_id(ds.id)
    inline = len(ds.rows) <= INLINE_ROW_LIMIT
    cols = ds.columns or (["col" + str(i) for i in range(len(ds.rows[0]))] if ds.rows else [])
    if inline:
        objs = [dict(zip(cols, row)) for row in ds.rows]
        decl = (
            f"const ds_{name} = new SharedArray({json.dumps(ds.name or ds.id)}, function () {{\n"
            f"  return {json.dumps(objs, ensure_ascii=False)};\n"
            f"}});"
        )
        return decl, None
    # внешний CSV с заголовком
    fname = ds.file_name or f"{name}.csv"
    lines = [",".join(_csv_escape(c) for c in cols)]
    for row in ds.rows:
        lines.append(",".join(_csv_escape(v) for v in row))
    csv = "\n".join(lines) + "\n"
    decl = (
        f"const ds_{name} = new SharedArray({json.dumps(ds.name or ds.id)}, function () {{\n"
        f"  return papaparse.parse(open({json.dumps('./' + fname)}), {{ header: true, skipEmptyLines: true }}).data;\n"
        f"}});"
    )
    return decl, GeneratedFile(name=fname, content=csv)


def _csv_escape(v: str) -> str:
    v = "" if v is None else str(v)
    if any(c in v for c in [",", '"', "\n"]):
        return '"' + v.replace('"', '""') + '"'
    return v


# --- Статический пролог с хелперами -------------------------------------------------

_HELPERS = r"""
let __counter = 0;
function nextCounter() { return ++__counter; }

function tsFormat(fmt) {
  const d = new Date();
  if (!fmt) return String(d.getTime());
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  return String(fmt)
    .replace(/yyyy/g, d.getFullYear())
    .replace(/MM/g, pad(d.getMonth() + 1))
    .replace(/dd/g, pad(d.getDate()))
    .replace(/HH/g, pad(d.getHours()))
    .replace(/mm/g, pad(d.getMinutes()))
    .replace(/ss/g, pad(d.getSeconds()));
}

function resolveToken(expr, vars, row) {
  const s = String(expr).trim();
  if (s === '__UUID()') return uuidv4();
  let m;
  if ((m = s.match(/^__Random\((\d+)\s*,\s*(\d+)\)$/))) return String(randomIntBetween(+m[1], +m[2]));
  if ((m = s.match(/^__RandomString\((\d+)(?:\s*,\s*(.*))?\)$/))) return randomString(+m[1], m[2] || undefined);
  if (s.match(/^__counter\(/)) return String(nextCounter());
  if ((m = s.match(/^__time\((.*)\)$/))) return tsFormat(m[1]);
  if (vars && Object.prototype.hasOwnProperty.call(vars, expr)) return String(vars[expr]);
  if (row && Object.prototype.hasOwnProperty.call(row, expr)) return String(row[expr]);
  return '';
}

function interp(tpl, vars, row) {
  if (tpl == null) return '';
  return String(tpl).replace(/\$\{([^}]+)\}/g, (_m, e) => resolveToken(e, vars, row));
}

function safeJson(res) { try { return res.json(); } catch (e) { return null; } }

function jsonPath(obj, expr, def) {
  try {
    if (obj == null) return def;
    let p = String(expr).replace(/^\$/, '').replace(/\[(\d+)\]/g, '.$1').replace(/^\./, '');
    if (!p) return obj == null ? def : obj;
    let cur = obj;
    for (const key of p.split('.')) {
      if (cur == null) return def;
      cur = cur[key];
    }
    return cur == null ? def : cur;
  } catch (e) { return def; }
}

function extractRegex(body, pattern, n, def) {
  try {
    const re = new RegExp(pattern);
    const m = re.exec(String(body));
    if (!m) return def;
    return m[1] !== undefined ? m[1] : m[0];
  } catch (e) { return def; }
}

function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function extractBoundary(body, left, right, def) {
  const pattern = escapeRegExp(left) + '(.*?)' + escapeRegExp(right);
  return extractRegex(body, pattern, 1, def);
}

function joinUrl(base, path) {
  if (!base) return path;
  const b = String(base).replace(/\/+$/, '');
  const p = String(path || '');
  return b + (p.startsWith('/') ? p : '/' + p);
}

// Замена {name} -> value без затрагивания ${name} (k6/JMeter-переменных).
function replaceBrace(tpl, name, value) {
  const token = '{' + name + '}';
  const s = String(tpl);
  let out = '';
  let i = 0;
  for (;;) {
    const idx = s.indexOf(token, i);
    if (idx === -1) { out += s.slice(i); break; }
    if (idx > 0 && s[idx - 1] === '$') { out += s.slice(i, idx + token.length); i = idx + token.length; continue; }
    out += s.slice(i, idx) + String(value);
    i = idx + token.length;
  }
  return out;
}
""".strip("\n")


# --- Главная сборка -----------------------------------------------------------------

def generate_k6(scenario: ScenarioDraft) -> K6Result:
    groups = _group(scenario)
    datasets = {d.id: d for d in scenario.datasets}
    load = scenario.load

    # какие датасеты реально используются группами
    used_ds_ids: list[str] = []
    for _members, ds_ids in groups:
        for dsid in ds_ids:
            if dsid in datasets and dsid not in used_ds_ids:
                used_ds_ids.append(dsid)

    data_files: list[GeneratedFile] = []
    ds_decls: list[str] = []
    needs_papaparse = False
    for dsid in used_ds_ids:
        decl, ext = _dataset_decl(datasets[dsid])
        ds_decls.append(decl)
        if ext is not None:
            data_files.append(ext)
            needs_papaparse = True

    # options.scenarios
    scenario_entries: list[str] = []
    exec_fns: list[str] = []
    for idx, (members, ds_ids) in enumerate(groups):
        key = f"g{idx}"
        intensity = members[0].intensity
        start, stages = _stages(intensity, load)
        # пик группы = target первого запроса (единая интенсивность группы)
        peak_rps = max(1.0, intensity.target_rps)
        pre, mx = _vu_sizing(peak_rps, load.assumed_latency_sec)
        names = " -> ".join(m.name for m in members)
        entry = (
            f"    {key}: {{\n"
            f"      executor: 'ramping-arrival-rate',\n"
            f"      startRate: {start},\n"
            f"      timeUnit: '1s',\n"
            f"      preAllocatedVUs: {pre},\n"
            f"      maxVUs: {mx},\n"
            f"      stages: {json.dumps(stages)},\n"
            f"      exec: {json.dumps(key)},\n"
            f"      tags: {{ group: {json.dumps(key)} }},\n"
            f"    }},"
        )
        scenario_entries.append(f"    // {names}\n{entry}")
        exec_fns.append(_emit_exec(key, members, ds_ids, datasets))

    # thresholds из AutoStop
    thresholds: dict[str, list] = {}
    a = scenario.autostop
    if a.enabled:
        if a.error_rate_pct > 0:
            thresholds["http_req_failed"] = [
                {
                    "threshold": f"rate<{a.error_rate_pct / 100.0}",
                    "abortOnFail": True,
                    "delayAbortEval": f"{max(1, a.error_rate_sec)}s",
                }
            ]
        if a.avg_response_ms > 0:
            thresholds["http_req_duration"] = [
                {
                    "threshold": f"avg<{a.avg_response_ms}",
                    "abortOnFail": True,
                    "delayAbortEval": f"{max(1, a.avg_response_sec)}s",
                }
            ]

    # импорты
    imports = [
        "import http from 'k6/http';",
        "import { check } from 'k6';",
        "import { SharedArray } from 'k6/data';",
        "import { scenario as _scn } from 'k6/execution';",
        "import { uuidv4, randomIntBetween, randomString } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';",
    ]
    if needs_papaparse:
        imports.append("import papaparse from 'https://jslib.k6.io/papaparse/5.1.1/index.js';")

    options_lines = [
        "export const options = {",
        "  scenarios: {",
        "\n".join(scenario_entries),
        "  },",
    ]
    if thresholds:
        options_lines.append(f"  thresholds: {json.dumps(thresholds)},")
    options_lines.append("};")

    parts: list[str] = []
    parts.append("// Сгенерировано порталом подготовки сценариев нагрузки (движок k6).")
    parts.append("// Модель: ramping-arrival-rate (open-model, интенсивность в RPS).")
    parts.append("\n".join(imports))
    parts.append(f"const BASE_URL = {json.dumps(scenario.base_url or '')};")
    if ds_decls:
        parts.append("\n\n".join(ds_decls))
    parts.append(_HELPERS)
    parts.append("\n".join(options_lines))
    parts.append("\n\n".join(exec_fns))

    script = "\n\n".join(p for p in parts if p) + "\n"

    base_name = re.sub(r"[^a-zA-Z0-9_.-]", "_", scenario.name or "scenario") or "scenario"
    return K6Result(filename=base_name, script=script, data_files=data_files)
