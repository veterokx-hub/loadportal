"""Генерация k6-скрипта (JavaScript) из доменной модели Scenario.

Соответствие семантике JMeter-сборки (JmxBuilder):
 - каждая ГРУППА (union-find по корреляции ${var} и общему dataset_id) = отдельный
   k6-scenario с исполнителем ramping-arrival-rate;
 - target_rps группы — HTTP-сэмплы/с, как Throughput Shaping Timer. arrival-rate
   = target_rps / сумма(repeat): одна итерация exec бьёт все запросы группы;
 - ramp стартует с min(1, target_rps) HTTP/с (как TST), не с нуля;
 - repeat запроса = цикл внутри exec-функции;
 - корреляция (json/regex/boundary) кладётся в объект vars и подставляется дальше;
 - валидация (код ответа, contains) = check(); провал валидации или status=0
   идёт в portal_errors (как assertion JMeter), не в сырой http_req_failed;
 - AutoStop.error_rate → threshold portal_errors (накопительный rate + delayAbortEval,
   не скользящее окно jpgc-autostop); в режиме smoke AutoStop выключен;
 - датасеты = SharedArray (инлайн для небольших, внешний CSV для больших — гибрид).

VU: preAllocatedVUs/maxVUs по закону Литтла (HTTP rps × assumed_latency × запас).

Контракт CI (lt-run), локальный запуск без переменных остаётся load:
 - BASE_URL = __ENV.BASE_URL или scenario.base_url;
 - LT_MODE = load | smoke; неизвестное значение роняет init;
 - smoke: constant-arrival-rate 1 итерация/с на группу, длительность LT_SMOKE_DURATION_SEC
   (по умолчанию 60). Ramp, target_rps и шардирование в скрипт не зашиты
   (долю шарда режет --execution-segment раннера);
 - smoke-покрытие: threshold http_reqs{name} count>0 на каждый запрос, без abortOnFail.
   Провал threshold — код выхода 99, раннер видит smoke как failed.
"""
from __future__ import annotations

import json
import math
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

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
# Тот же алфавит, что у JMeter __RandomString и Gatling-генератора.
DEFAULT_RANDOM_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789"


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


_VENDOR = Path(__file__).resolve().parent / "vendor"


def _vendor_files(needs_papaparse: bool) -> list[GeneratedFile]:
    """k6-utils 1.4.0 и Papa Parse 5.1.1 лежат рядом со script.js. Сеть не нужна."""
    utils = _VENDOR / "k6-utils"
    files = [
        GeneratedFile(f"lib/k6-utils/{path.name}", path.read_text(encoding="utf-8"))
        for path in sorted(utils.glob("*.js"))
    ]
    if not files:
        raise RuntimeError("В образе нет vendor/k6-utils")
    if needs_papaparse:
        papa = _VENDOR / "papaparse.js"
        if not papa.is_file():
            raise RuntimeError("В образе нет vendor/papaparse.js")
        files.append(GeneratedFile("lib/papaparse.js", papa.read_text(encoding="utf-8")))
    return files


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

def _arrival_unit(rates: list[float]) -> tuple[str, int]:
    """k6 ramping-arrival-rate принимает только целые target/startRate.
    При RPS < 1 переходим на 1m или 1h, чтобы не генерировать 0.01."""
    positive = [r for r in rates if r > 0]
    if not positive:
        return "1s", 1
    mn = min(positive)
    if mn >= 1:
        return "1s", 1
    if mn * 60 >= 1:
        return "1m", 60
    return "1h", 3600


def _int_rate(rps: float, scale: int) -> int:
    if rps <= 0:
        return 0
    return max(1, int(round(rps * scale)))


def _scale_arrival(start: float | int, stages: list[dict]) -> tuple[str, int, list[dict]]:
    rates = [float(start)] + [float(s["target"]) for s in stages]
    unit, scale = _arrival_unit(rates)
    start_i = 0 if float(start) <= 0 else _int_rate(float(start), scale)
    scaled = [
        {"target": _int_rate(float(s["target"]), scale), "duration": s["duration"]}
        for s in stages
    ]
    return unit, start_i, scaled


def _rate(v: float) -> float | int:
    """k6 arrival-rate: сохраняем дробные RPS (0.01), целые без хвоста .0."""
    r = round(float(v), 6)
    if r == int(r):
        return int(r)
    return r


def _samples_per_iteration(members: list[Request]) -> int:
    """Число HTTP-сэмплов за одну итерацию группы (сумма repeat)."""
    return max(1, sum(max(1, r.repeat) for r in members))


def _arrival_of(http_rps: float, samples: int) -> float:
    """HTTP RPS группы → k6 arrival-rate (старты exec/с)."""
    http = max(0.0, float(http_rps))
    n = max(1, samples)
    return http if n == 1 else http / n


def _stages(
    arrival_target: float,
    intensity,
    load,
    arrival_start: float | None = None,
) -> tuple[float | int, list[dict]]:
    target = max(0.0, float(arrival_target))
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
        raw_start = 0.0 if arrival_start is None else max(0.0, float(arrival_start))
        start: float | int = _rate(min(raw_start, target)) if target > 0 else 0
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

def _gen_expr(g, name: str = "") -> str:
    t = g.type
    if t == GeneratorType.UUID:
        return "uuidv4()"
    if t == GeneratorType.RANDOM_INT:
        return f"String(randomIntBetween({g.min if g.min is not None else 0}, {g.max if g.max is not None else 1000000}))"
    if t == GeneratorType.RANDOM_STRING:
        chars = json.dumps(g.chars or DEFAULT_RANDOM_CHARS)
        return f"randomString({g.length if g.length is not None else 8}, {chars})"
    if t == GeneratorType.COUNTER:
        start = g.start if g.start is not None else 1
        incr = g.increment if getattr(g, "increment", None) is not None else 1
        mx = g.max if g.max is not None else 0
        return (
            f"nextCounter({json.dumps(name)}, {start}, {incr}, {mx}, {json.dumps(g.format or '')})"
        )
    if t == GeneratorType.TIMESTAMP:
        return f"tsFormat({json.dumps(g.format or '')})"
    return "''"


def _param_expr(p) -> str:
    s = p.source
    kind = _param_source_kind(s)
    if kind == "generator":
        gen = _generator_obj(s)
        return _gen_expr(gen, p.name) if gen is not None else "''"
    if kind == "correlation":
        return f"(vars[{json.dumps(_correlation_var(s))}] ?? '')"
    if kind == "csv":
        return f"(row[{json.dumps(_csv_column(s))}] ?? '')"
    return f"interp({json.dumps(_constant_text(s))}, vars, row)"


# --- Рендер exec-функции группы -----------------------------------------------------

def _unique_request_names(requests: list[Request]) -> dict[str, str]:
    """Одинаковые имена ломают тег name и threshold. Второй дубль — «имя#2»."""
    seen: dict[str, int] = {}
    out: dict[str, str] = {}
    for req in sorted(requests, key=lambda r: r.order):
        base = (req.name or "").strip() or "request"
        n = seen.get(base, 0) + 1
        seen[base] = n
        out[req.id] = base if n == 1 else f"{base}#{n}"
    return out


def _smoke_selector(name: str) -> str:
    if re.fullmatch(r"[A-Za-z0-9_.-]+", name):
        return f"http_reqs{{name:{name}}}"
    escaped = name.replace("\\", "\\\\").replace('"', '\\"')
    return f'http_reqs{{name:"{escaped}"}}'


def _emit_request(req: Request, request_name: str) -> list[str]:
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

    L.append(
        f"{b}res = http.request({json.dumps(_enum_str(req.method))}, url, body, "
        f"{{ headers, tags: {{ name: {json.dumps(request_name)} }} }});"
    )

    checks: list[str] = []
    fail_parts = ["res.status === 0"]
    v = req.validation
    if v.check_response_code:
        checks.append(f"{json.dumps('status is ' + str(v.expected_status))}: (r) => r.status === {v.expected_status}")
        fail_parts.append(f"res.status !== {v.expected_status}")
    if v.response_contains:
        checks.append(
            f"{json.dumps('body contains ' + v.response_contains)}: (r) => !!r.body && String(r.body).includes({json.dumps(v.response_contains)})"
        )
        fail_parts.append(
            f"!String(res.body || '').includes({json.dumps(v.response_contains)})"
        )
    if checks:
        L.append(f"{b}check(res, {{ {', '.join(checks)} }});")
    L.append(f"{b}portal_errors.add({' || '.join(fail_parts)});")

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
            L.append(f"{b}vars[{var}] = extractBoundary(res.body, {left}, {right}, {ex.match_no}, {dv});")

    L.append(f"{base_ind}}}")
    if open_loop:
        L.append(f"{ind}}}")
    return L


def _emit_exec(
    key: str,
    members: list[Request],
    ds_ids: list[str],
    datasets: dict[str, Dataset],
    names: dict[str, str],
) -> str:
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
        L.extend(_emit_request(req, names.get(req.id) or req.name or "request"))
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
    # Внешний CSV: первая строка — заголовки колонок (как в портале и JMeter ignoreFirstLine=true).
    # papaparse header:true читает имена колонок из первой строки, данные — со второй.
    fname = _safe_csv_name(ds.file_name, f"{name}.csv")
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


def _safe_csv_name(file_name: str | None, fallback: str) -> str:
    base = os.path.basename((file_name or fallback).replace("\\", "/"))
    base = re.sub(r"[^a-zA-Z0-9_.-]", "_", base)
    if not base or ".." in base:
        base = fallback
    return base if base.lower().endswith(".csv") else f"{base}.csv"


def _csv_escape(v: str) -> str:
    v = "" if v is None else str(v)
    if any(c in v for c in [",", '"', "\n"]):
        return '"' + v.replace('"', '""') + '"'
    return v


# --- Статический пролог с хелперами -------------------------------------------------

_HELPERS = r"""
const __counters = Object.create(null);
function nextCounter(name, start, incr, max, fmt) {
  // Как JMeter CounterConfig: одно значение на итерацию VU, а не на каждый HTTP.
  const key = name || '_';
  const s0 = start == null ? 1 : start;
  const step = incr == null ? 1 : incr;
  let slot = __counters[key];
  if (slot == null) slot = __counters[key] = { iter: -1, value: s0 - step };
  if (slot.iter !== __ITER) {
    slot.iter = __ITER;
    slot.value += step;
    if (max > 0 && slot.value > max) slot.value = s0;
  }
  const s = String(slot.value);
  if (!fmt) return s;
  return s.padStart(String(fmt).length, '0');
}

function tsFormat(fmt) {
  const d = new Date();
  if (!fmt) return String(d.getTime());
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  const tokens = {
    yyyy: String(d.getFullYear()),
    MM: pad(d.getMonth() + 1),
    dd: pad(d.getDate()),
    HH: pad(d.getHours()),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
  };
  // SimpleDateFormat: 'T' — литерал, не токен.
  return String(fmt).replace(/'([^']*)'|yyyy|MM|dd|HH|mm|ss/g, (m, lit) => (
    lit !== undefined ? lit : (tokens[m] || m)
  ));
}

function resolveToken(expr, vars, row) {
  const s = String(expr).trim();
  if (s === '__UUID()') return uuidv4();
  let m;
  if ((m = s.match(/^__Random\((\d+)\s*,\s*(\d+)\)$/))) return String(randomIntBetween(+m[1], +m[2]));
  if ((m = s.match(/^__RandomString\((\d+)(?:\s*,\s*(.*))?\)$/))) return randomString(+m[1], m[2] || undefined);
  if (s.match(/^__counter\(/)) return nextCounter('_fn', 1, 1, 0, '');
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
    const re = new RegExp(pattern, 'g');
    const s = String(body);
    const want = Math.max(1, n | 0);
    let m;
    let i = 0;
    while ((m = re.exec(s))) {
      i += 1;
      if (i === want) return m[1] !== undefined ? m[1] : m[0];
      if (m[0] === '') re.lastIndex += 1;
    }
    return def;
  } catch (e) { return def; }
}

function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function extractBoundary(body, left, right, n, def) {
  const pattern = escapeRegExp(left) + '(.*?)' + escapeRegExp(right);
  return extractRegex(body, pattern, n, def);
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

    request_names = _unique_request_names(scenario.requests)

    # options.scenarios: load — как раньше; smoke — 1 итерация/с на группу
    load_entries: list[str] = []
    smoke_entries: list[str] = []
    exec_fns: list[str] = []
    for idx, (members, ds_ids) in enumerate(groups):
        key = f"g{idx}"
        intensity = members[0].intensity
        samples = _samples_per_iteration(members)
        http_peak = max(0.0, intensity.target_rps)
        arrival = _arrival_of(http_peak, samples)
        arrival_start = _arrival_of(min(1.0, http_peak) if http_peak > 0 else 0.0, samples)
        start, stages = _stages(arrival, intensity, load, arrival_start)
        time_unit, start_rate, stages = _scale_arrival(start, stages)
        pre, mx = _vu_sizing(max(http_peak, 0.01), load.assumed_latency_sec)
        chain = " -> ".join(request_names.get(m.id) or m.name for m in members)
        entry = (
            f"    {key}: {{\n"
            f"      executor: 'ramping-arrival-rate',\n"
            f"      startRate: {start_rate},\n"
            f"      timeUnit: {json.dumps(time_unit)},\n"
            f"      preAllocatedVUs: {pre},\n"
            f"      maxVUs: {mx},\n"
            f"      stages: {json.dumps(stages)},\n"
            f"      exec: {json.dumps(key)},\n"
            f"      tags: {{ group: {json.dumps(key)} }},\n"
            f"    }},"
        )
        comment = (
            f"{chain} · {samples} HTTP/итерацию · "
            f"arrival {_rate(arrival)}/s ≈ {_rate(http_peak)} HTTP/s"
        )
        load_entries.append(f"    // {comment}\n{entry}")
        smoke_entries.append(
            f"    {key}: {{\n"
            f"      executor: 'constant-arrival-rate',\n"
            f"      rate: 1,\n"
            f"      timeUnit: '1s',\n"
            f"      duration: `${{SMOKE_SEC}}s`,\n"
            f"      preAllocatedVUs: 1,\n"
            f"      maxVUs: 3,\n"
            f"      exec: {json.dumps(key)},\n"
            f"      tags: {{ group: {json.dumps(key)} }},\n"
            f"    }},"
        )
        exec_fns.append(_emit_exec(key, members, ds_ids, datasets, request_names))

    # thresholds из AutoStop
    thresholds: dict[str, list] = {}
    a = scenario.autostop
    if a.enabled:
        if a.error_rate_pct > 0:
            thresholds["portal_errors"] = [
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
        "import { Rate } from 'k6/metrics';",
        "import { SharedArray } from 'k6/data';",
        "import { scenario as _scn } from 'k6/execution';",
        "import { uuidv4, randomIntBetween, randomString } from './lib/k6-utils/index.js';",
    ]
    if needs_papaparse:
        imports.append("import papaparse from './lib/papaparse.js';")

    smoke_thresholds = {
        _smoke_selector(request_names[req.id]): ["count>0"]
        for req in sorted(scenario.requests, key=lambda r: r.order)
    }

    options_lines = [
        "const LOAD_SCENARIOS = {",
        "\n".join(load_entries),
        "};",
        "const SMOKE_SCENARIOS = {",
        "\n".join(smoke_entries),
        "};",
        f"const LOAD_THRESHOLDS = {json.dumps(thresholds)};",
        f"const SMOKE_THRESHOLDS = {json.dumps(smoke_thresholds)};",
        "export const options = {",
        "  scenarios: LT_MODE === 'smoke' ? SMOKE_SCENARIOS : LOAD_SCENARIOS,",
        "  thresholds: LT_MODE === 'smoke' ? SMOKE_THRESHOLDS : LOAD_THRESHOLDS,",
        "};",
    ]

    parts: list[str] = []
    parts.append("// Сгенерировано порталом подготовки сценариев нагрузки (движок k6).")
    parts.append(
        "// Целевой RPS группы — HTTP-сэмплы/с (как JMeter TST). "
        "arrival-rate = RPS / число HTTP за итерацию."
    )
    parts.append(
        "// CI: LT_MODE=load|smoke, LT_SMOKE_DURATION_SEC, BASE_URL. "
        "Без переменных — load, base_url сценария."
    )
    parts.append("\n".join(imports))
    parts.append(
        f"const BASE_URL = __ENV.BASE_URL || {json.dumps(scenario.base_url or '')};\n"
        "const LT_MODE = __ENV.LT_MODE || 'load';\n"
        "const SMOKE_SEC = parseInt(__ENV.LT_SMOKE_DURATION_SEC || '60', 10);\n"
        "if (LT_MODE !== 'load' && LT_MODE !== 'smoke') {\n"
        "  throw new Error('неизвестный LT_MODE=' + LT_MODE + ' (ожидается load или smoke)');\n"
        "}"
    )
    if ds_decls:
        parts.append("\n\n".join(ds_decls))
    parts.append("const portal_errors = new Rate('portal_errors');")
    parts.append(_HELPERS)
    parts.append("\n".join(options_lines))
    parts.append("\n\n".join(exec_fns))

    script = "\n\n".join(p for p in parts if p) + "\n"

    base_name = re.sub(r"[^a-zA-Z0-9_.-]", "_", scenario.name or "scenario") or "scenario"
    return K6Result(
        filename=base_name,
        script=script,
        data_files=_vendor_files(needs_papaparse) + data_files,
    )
