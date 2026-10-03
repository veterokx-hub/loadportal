"""Генерация Gatling-проекта (Java DSL + Maven) из доменной модели Scenario.

Почему проект, а не файл: Gatling исполняет скомпилированную Simulation, поэтому
артефакт — всегда zip (pom.xml + Simulation + CSV + gatling.conf).

Как переносится семантика портала (сверено с JmxBuilder и k6_generator):
 - каждая ГРУППА (union-find по корреляции ${var} и общему dataset_id) = отдельный
   Gatling-scenario в одном setUp (параллельно, как тред-группы JMeter);
 - target_rps группы — HTTP-сэмплы/с. Gatling throttle официально не годится для
   многозапросных цепочек (перекос распределения между запросами), поэтому берём
   открытую модель инъекции: usersPerSec = target_rps / число HTTP за итерацию;
 - постоянная нагрузка: rampUsersPerSec(...).to(...) + constantUsersPerSec(...).randomized()
   (рандомизация интервалов — против «лестницы» синхронных стартов на длинном тесте);
 - поиск максимума: нативная лестница incrementUsersPerSec().times().eachLevelLasting()
   без рамп между ступенями — ровные полки, как у Throughput Shaping Timer;
 - repeat запроса = repeat(n).on(...);
 - корреляция: check(...).withDefault(...).saveAs(...) → EL #{var};
 - валидация: status().is(...) + substring(...).exists() (провал = KO запроса);
 - AutoStop: скользящее окно по ошибкам и среднему отклику + crashLoadGeneratorIf,
   то есть реальный обрыв теста на ходу (эквивалент jpgc-autostop), плюс assertions
   как итоговый вердикт прогона. В режиме smoke AutoStop не исполняется;
 - метрики: Gatling OSS с 3.12 не умеет real-time экспорт (Graphite удалён,
   InfluxDB/OTel — Enterprise), поэтому пишем console+file и HTML-отчёт.

Контракт CI (lt-run), локальный `mvn gatling:test` без -D остаётся load:
 - baseUrl, lt.mode (load|smoke), lt.smokeDurationSec (60), loadFactor (1.0);
 - неизвестный lt.mode — IllegalArgumentException при загрузке класса;
 - load: каждая интенсивность (ramp/constant/increment/startingFrom) умножается
   на LOAD_FACTOR в сгенерированном Java, длительности не трогаются;
 - smoke: constantUsersPerSec(1) на группу на всю длительность, без randomized
   и без AutoStop. Покрытие — details(имя).allRequests().count().gt(0) на запрос.
"""
from __future__ import annotations

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

GATLING_VERSION = "3.13.5"
GATLING_MAVEN_PLUGIN_VERSION = "4.16.3"
JAVA_RELEASE = "17"

VAR_RE = re.compile(r"\$\{([a-zA-Z0-9_]+)\}")
SIMULATION_PACKAGE = "portal"
SIMULATION_CLASS = "PortalSimulation"
DEFAULT_RANDOM_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789"


@dataclass
class GeneratedFile:
    name: str
    content: str


@dataclass
class GatlingResult:
    filename: str  # базовое имя без расширения
    files: list[GeneratedFile] = field(default_factory=list)


# --- Мелкие помощники ---------------------------------------------------------------

def _enum_str(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, Enum):
        return str(v.value)
    return str(v)


def _java(s: Any) -> str:
    """Java-литерал строки (файл пишется в UTF-8, юникод оставляем как есть)."""
    text = "" if s is None else str(s)
    out = (
        text.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\r", "\\r")
        .replace("\n", "\\n")
        .replace("\t", "\\t")
    )
    return '"' + out + '"'


def _d(v: float) -> str:
    s = f"{float(v):.6f}".rstrip("0")
    return s + "0" if s.endswith(".") else s


def _el(text: Any) -> str:
    """JMeter-диалект портала -> Gatling EL: ${var} становится #{var}."""
    return VAR_RE.sub(r"#{\1}", "" if text is None else str(text))


def _param_source_kind(source: Any) -> str:
    if isinstance(source, dict):
        return str(source.get("kind") or "constant")
    return str(getattr(source, "kind", "constant"))


def _constant_text(source: Any) -> str:
    if isinstance(source, dict):
        return str(source.get("value") or "")
    return str(getattr(source, "value", "") or "")


def _el_ident(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_]", "", name or "")
    if not cleaned or cleaned[0].isdigit():
        cleaned = "v_" + cleaned
    return cleaned


def _date_pattern(fmt: str) -> str:
    if re.fullmatch(r"[yMdHmsSEaGzwWDkF :./T'_-]+", fmt or ""):
        return fmt
    return "yyyy-MM-dd'T'HH:mm:ss"


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


def _java_id(s: str) -> str:
    out = re.sub(r"[^a-zA-Z0-9_]", "_", s or "")
    return out or "x"


# --- Группировка (зеркало ScenarioGrouping.java и k6_generator._group) --------------

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


def _samples_per_iteration(members: list[Request]) -> int:
    return max(1, sum(max(1, r.repeat) for r in members))


def _arrival_of(http_rps: float, samples: int) -> float:
    http = max(0.0, float(http_rps))
    n = max(1, samples)
    return http if n == 1 else http / n


# --- Значения параметров -> Gatling EL ----------------------------------------------

def _feeder_params(scenario: ScenarioDraft) -> dict[str, Any]:
    """Счётчики: одно значение на итерацию сценария, как CounterConfig в JMeter.

    uuid / randomInt / timestamp — EL на каждый запрос.
    randomString тоже на каждый запрос (через session.set перед http), а не фидер:
    иначе repeat>1 слал одну и ту же строку, в отличие от JMeter __RandomString.
    """
    out: dict[str, Any] = {}
    for req in scenario.requests:
        for p in req.params:
            if _param_source_kind(p.source) != "generator":
                continue
            gen = _generator_obj(p.source)
            if gen is None or not p.name:
                continue
            if gen.type == GeneratorType.COUNTER:
                out.setdefault(p.name, gen)
    return out


def _random_string_params(req: Request) -> list:
    out = []
    for p in req.params:
        if _param_source_kind(p.source) != "generator" or not p.name:
            continue
        gen = _generator_obj(p.source)
        if gen is not None and gen.type == GeneratorType.RANDOM_STRING:
            out.append((p, gen))
    return out


def _gen_el(gen, name: str) -> str:
    t = gen.type
    if t == GeneratorType.UUID:
        return "#{randomUuid()}"
    if t == GeneratorType.RANDOM_INT:
        lo = gen.min if gen.min is not None else 0
        hi = gen.max if gen.max is not None else 1_000_000
        # JMeter __Random(min,max) включает max, Gatling randomInt — нет.
        return f"#{{randomInt({lo},{int(hi) + 1})}}"
    if t == GeneratorType.TIMESTAMP:
        fmt = gen.format or ""
        return "#{currentTimeMillis()}" if not fmt else f"#{{currentDate({_date_pattern(fmt)})}}"
    # counter / randomString — из фидера под именем параметра
    return "#{" + name + "}"


def _param_el(p) -> str:
    kind = _param_source_kind(p.source)
    if kind == "generator":
        gen = _generator_obj(p.source)
        return _gen_el(gen, p.name) if gen is not None else ""
    if kind == "correlation":
        return "#{" + _el_ident(_correlation_var(p.source)) + "}"
    if kind == "csv":
        return "#{" + _el_ident(_csv_column(p.source)) + "}"
    return _el(_constant_text(p.source))


def _replace_brace(text: str, name: str, value: str) -> str:
    """{name} -> value, не задевая уже переведённые #{name} и ${name}."""
    if not text or not name:
        return text or ""
    return re.sub(r"(?<![$#])\{" + re.escape(name) + r"\}", value.replace("\\", "\\\\"), text)


# --- Рендер запроса -----------------------------------------------------------------

_HTTP_VERBS = {"GET": "get", "POST": "post", "PUT": "put", "PATCH": "patch",
               "DELETE": "delete", "HEAD": "head", "OPTIONS": "options"}


def _request_url(req: Request) -> str:
    custom = (req.url or "").strip()
    raw = custom or (req.path or "/")
    for p in req.params:
        if p.location == ParamLocation.PATH:
            raw = _replace_brace(raw, p.name, _param_el(p))
    return _el(raw)


def _unique_request_names(requests: list[Request]) -> dict[str, str]:
    """Одинаковые имена схлопывают assertions details(). Второй дубль — «имя#2»."""
    seen: dict[str, int] = {}
    out: dict[str, str] = {}
    for req in sorted(requests, key=lambda r: r.order):
        base = (req.name or "").strip() or "request"
        n = seen.get(base, 0) + 1
        seen[base] = n
        out[req.id] = base if n == 1 else f"{base}#{n}"
    return out


def _users_per_sec(v: float) -> str:
    """Интенсивность приходит в рантайме: N шардов дают суммарно целевой поток."""
    return f"({_d(v)} * LOAD_FACTOR)"


def _emit_request(req: Request, autostop: bool, indent: str, request_name: str) -> list[str]:
    L: list[str] = []
    i = indent
    rs = _random_string_params(req)
    if rs:
        L.append(f"{i}exec(session -> {{")
        L.append(f"{i}    Session s = session;")
        for p, gen in rs:
            length = int(gen.length) if gen.length is not None else 8
            chars = gen.chars or DEFAULT_RANDOM_CHARS
            L.append(
                f"{i}    s = s.set({_java(p.name)}, randomString({length}, {_java(chars)}));"
            )
        L.append(f"{i}    return s;")
        L.append(f"{i}}})")
        L.append(f"{i}.exec(")
    else:
        L.append(f"{i}exec(")

    method = _enum_str(req.method).upper() or "GET"
    verb = _HTTP_VERBS.get(method)
    url = _request_url(req)

    L.append(f"{i}    http({_java(request_name)})")
    if verb:
        L.append(f"{i}        .{verb}({_java(url)})")
    else:
        L.append(f"{i}        .httpRequest({_java(method)}, {_java(url)})")

    for qp in req.params:
        if qp.location == ParamLocation.QUERY and qp.name:
            L.append(f"{i}        .queryParam({_java(qp.name)}, {_java(_param_el(qp))})")

    headers: dict[str, str] = {}
    for h in req.headers:
        if h.key:
            headers[h.key] = _el(h.value or "")
    for hp in req.params:
        if hp.location == ParamLocation.HEADER and hp.name:
            headers[hp.name] = _param_el(hp)

    body_mode = _enum_str(req.body.mode) if req.body else "none"
    body_content = (req.body.content or "") if req.body else ""
    has_body = body_mode != "none" and body_content != ""
    if has_body and req.body.content_type and "Content-Type" not in headers:
        headers["Content-Type"] = req.body.content_type

    for k, v in headers.items():
        L.append(f"{i}        .header({_java(k)}, {_java(v)})")

    if has_body:
        rendered = body_content
        for p in req.params:
            if p.location == ParamLocation.BODY:
                rendered = _replace_brace(rendered, p.name, _param_el(p))
        L.append(f"{i}        .body(StringBody({_java(_el(rendered))}))")

    v = req.validation
    if v.check_response_code:
        L.append(f"{i}        .check(status().is({int(v.expected_status)}))")
    if v.response_contains:
        L.append(f"{i}        .check(substring({_java(v.response_contains)}).exists())")

    for ex in req.extractions:
        if not ex.variable:
            continue
        n = max(0, int(ex.match_no) - 1)
        ex_type = _enum_str(ex.type)
        if ex_type == "json":
            target = f"jsonPath({_java(ex.expression)})"
        elif ex_type == "regex":
            target = f"regex({_java(ex.expression)})"
        else:
            parts = (ex.expression or "").split("|", 1)
            left = re.escape(parts[0] if parts else "")
            right = re.escape(parts[1] if len(parts) > 1 else "")
            target = f"regex({_java(left + '(.*?)' + right)})"
        L.append(
            f"{i}        .check({target}.find({n})"
            f".withDefault({_java(ex.default_value)}).saveAs({_java(_el_ident(ex.variable))}))"
        )

    if autostop:
        L.append(f'{i}        .check(responseTimeInMillis().saveAs("__rt"))')

    L.append(f"{i})")
    if autostop:
        L.append(f"{i}    .exec(Autostop::record)")
        L.append(f"{i}    .crashLoadGeneratorIf(AUTOSTOP_MESSAGE, session -> Autostop.tripped())")
    return L


def _emit_scenario(key: str, members: list[Request], ds_ids: list[str],
                   datasets: dict[str, Dataset], feeder_used: bool,
                   autostop: bool, names: dict[str, str]) -> str:
    title = " -> ".join(m.name for m in members)
    L: list[str] = []
    L.append(f"    private final ScenarioBuilder {key} = scenario({_java(title)})")
    if feeder_used:
        L.append("        .feed(GENERATED_VALUES)")
    for dsid in ds_ids:
        ds = datasets.get(dsid)
        if ds is None:
            continue
        L.append(f"        .feed(FEEDER_{_java_id(dsid).upper()})")

    for idx, req in enumerate(members):
        repeat = max(1, req.repeat)
        if repeat > 1:
            L.append(f"        .repeat({repeat}).on(")
            L.extend(_emit_request(req, autostop, "            ", names.get(req.id) or req.name))
            L.append("        )")
        else:
            body = _emit_request(req, autostop, "        ", names.get(req.id) or req.name)
            # первый элемент цепочки — .exec(...), остальные уже с точкой
            body[0] = body[0].replace("exec(", ".exec(", 1)
            L.extend(body)
    L.append("        ;")
    return "\n".join(L)


# --- Профиль инъекции ---------------------------------------------------------------

def _injection(intensity, load, samples: int, indent: str) -> tuple[list[str], int]:
    """Аргументы injectOpen(...) + длительность профиля в секундах."""
    http_peak = max(0.0, float(intensity.target_rps))
    target = _arrival_of(http_peak, samples)

    if load.test_mode == TestMode.MAX_SEARCH:
        steps = max(1, int(load.steps))
        dur = max(1, int(load.step_duration_sec))
        step_rate = target / steps if steps else target
        # Ступени step_rate, 2*step_rate, ... , target — ровные полки без ramp между ними.
        ladder = (
            f"incrementUsersPerSec({_users_per_sec(step_rate)})\n"
            f"{indent}        .times({steps})\n"
            f"{indent}        .eachLevelLasting(Duration.ofSeconds({dur}))\n"
            f"{indent}        .startingFrom({_users_per_sec(step_rate)})"
        )
        return [ladder], steps * dur

    ramp = max(0, int(intensity.ramp_up_sec))
    hold = max(1, int(intensity.hold_sec))
    steps_java: list[str] = []
    if ramp > 0:
        start = _arrival_of(min(1.0, http_peak), samples)
        steps_java.append(
            f"rampUsersPerSec({_users_per_sec(start)}).to({_users_per_sec(target)})"
            f".during(Duration.ofSeconds({ramp}))"
        )
    steps_java.append(
        f"constantUsersPerSec({_users_per_sec(target)})"
        f".during(Duration.ofSeconds({hold})).randomized()"
    )
    return steps_java, ramp + hold


# --- AutoStop -----------------------------------------------------------------------

def _autostop_block(a) -> str:
    err_rate = max(0.0, float(a.error_rate_pct)) / 100.0
    err_window = max(1, int(a.error_rate_sec)) if a.error_rate_pct > 0 else 0
    avg_ms = max(0, int(a.avg_response_ms))
    avg_window = max(1, int(a.avg_response_sec)) if avg_ms > 0 else 0
    return f"""    /**
     * Скользящее окно, как jpgc-autostop: доля KO и средний отклик считаются за
     * последние N секунд, а не с начала теста. Критерий не срабатывает, пока окно
     * не набралось целиком — иначе одна ранняя ошибка убивала бы прогон.
     * При пробитии порога crashLoadGeneratorIf рвёт тест с ненулевым кодом выхода.
     */
    static final class Autostop {{
        private static final double ERROR_RATE = {err_rate:.6f};
        private static final long ERROR_WINDOW_MS = {err_window}L * 1000L;
        private static final long AVG_RESPONSE_MS = {avg_ms}L;
        private static final long AVG_WINDOW_MS = {avg_window}L * 1000L;
        private static final long KEEP_MS = Math.max(ERROR_WINDOW_MS, AVG_WINDOW_MS);

        private static final Deque<long[]> WINDOW = new ArrayDeque<>();
        private static long firstSampleMs = 0L;
        private static volatile boolean tripped = false;

        private Autostop() {{
        }}

        /** Пишет исход запроса и сбрасывает статус сессии: KO следующего запроса — только его. */
        static Session record(Session session) {{
            boolean ko = session.isFailed();
            long rt = 0L;
            Object raw = session.get("__rt");
            if (raw instanceof Number) {{
                rt = ((Number) raw).longValue();
            }}
            evaluate(ko, rt);
            return ko ? session.markAsSucceeded() : session;
        }}

        static boolean tripped() {{
            return tripped;
        }}

        private static synchronized void evaluate(boolean ko, long responseMs) {{
            long now = System.currentTimeMillis();
            if (firstSampleMs == 0L) {{
                firstSampleMs = now;
            }}
            long elapsed = now - firstSampleMs;
            WINDOW.addLast(new long[] {{now, ko ? 1L : 0L, responseMs}});
            while (!WINDOW.isEmpty() && now - WINDOW.peekFirst()[0] > KEEP_MS) {{
                WINDOW.removeFirst();
            }}
            if (ERROR_WINDOW_MS > 0 && ERROR_RATE > 0 && elapsed >= ERROR_WINDOW_MS) {{
                long total = 0;
                long errors = 0;
                for (long[] s : WINDOW) {{
                    if (now - s[0] <= ERROR_WINDOW_MS) {{
                        total++;
                        errors += s[1];
                    }}
                }}
                if (total > 0 && (double) errors / total > ERROR_RATE) {{
                    tripped = true;
                }}
            }}
            if (AVG_WINDOW_MS > 0 && AVG_RESPONSE_MS > 0 && elapsed >= AVG_WINDOW_MS) {{
                long total = 0;
                long sum = 0;
                for (long[] s : WINDOW) {{
                    if (now - s[0] <= AVG_WINDOW_MS) {{
                        total++;
                        sum += s[2];
                    }}
                }}
                if (total > 0 && sum / total > AVG_RESPONSE_MS) {{
                    tripped = true;
                }}
            }}
        }}
    }}
"""


def _smoke_assertions(requests: list[Request], names: dict[str, str]) -> list[str]:
    return [
        f"details({_java(names.get(req.id) or req.name)}).allRequests().count().gt(0L)"
        for req in sorted(requests, key=lambda r: r.order)
    ]


def _assertions(a) -> list[str]:
    out: list[str] = []
    if a.error_rate_pct > 0:
        out.append(f"global().failedRequests().percent().lt({_d(a.error_rate_pct)})")
    if a.avg_response_ms > 0:
        out.append(f"global().responseTime().mean().lt({int(a.avg_response_ms)})")
    return out


# --- Генераторы значений (фидер) ----------------------------------------------------

def _generated_values_block(params: dict[str, Any], need_random_string: bool) -> str:
    if not params and not need_random_string:
        return ""
    lines: list[str] = []
    counters: list[str] = []
    puts: list[str] = []
    for name, gen in params.items():
        start = int(gen.start) if gen.start is not None else 1
        incr = int(gen.increment) if gen.increment is not None else 1
        mx = int(gen.max) if gen.max is not None else 0
        pad = len(gen.format or "")
        field_name = "COUNTER_" + _java_id(name).upper()
        counters.append(
            f"    private static final AtomicLong {field_name} = new AtomicLong({start - incr}L);"
        )
        puts.append(
            f"                    values.put({_java(name)}, "
            f"nextCounter({field_name}, {start}L, {incr}L, {mx}L, {pad}));"
        )

    lines.extend(counters)
    if counters:
        lines.append("")
        lines.append("    /** Счётчик: одно значение на итерацию, как CounterConfig в JMeter. */")
        lines.append("    private static final Iterator<Map<String, Object>> GENERATED_VALUES =")
        lines.append("            new Iterator<Map<String, Object>>() {")
        lines.append("                @Override")
        lines.append("                public boolean hasNext() {")
        lines.append("                    return true;")
        lines.append("                }")
        lines.append("")
        lines.append("                @Override")
        lines.append("                public Map<String, Object> next() {")
        lines.append("                    Map<String, Object> values = new HashMap<>();")
        lines.extend(puts)
        lines.append("                    return values;")
        lines.append("                }")
        lines.append("            };")
        lines.append("")
        lines.append("""    private static String nextCounter(AtomicLong holder, long start, long incr, long max, int pad) {
        long value = holder.addAndGet(incr);
        if (max > 0 && value > max) {
            holder.set(start);
            value = start;
        }
        String text = Long.toString(value);
        while (pad > text.length()) {
            text = "0" + text;
        }
        return text;
    }
""")
    if need_random_string:
        lines.append("""    private static String randomString(int length, String chars) {
        StringBuilder sb = new StringBuilder(length);
        for (int i = 0; i < length; i++) {
            sb.append(chars.charAt(ThreadLocalRandom.current().nextInt(chars.length())));
        }
        return sb.toString();
    }
""")
    return "\n".join(lines)


# --- Датасеты -----------------------------------------------------------------------

def _csv_escape(v: Any) -> str:
    text = "" if v is None else str(v)
    if any(c in text for c in [",", '"', "\n"]):
        return '"' + text.replace('"', '""') + '"'
    return text


def _dataset_file(ds: Dataset) -> tuple[str, GeneratedFile]:
    raw = (ds.file_name or f"{ds.id}.csv").replace("\\", "/").rsplit("/", 1)[-1]
    name = re.sub(r"[^a-zA-Z0-9_.-]", "_", raw)
    name = name.replace("..", "_")
    if not name.lower().endswith(".csv"):
        name += ".csv"
    cols = ds.columns or (
        [f"col{i}" for i in range(len(ds.rows[0]))] if ds.rows else []
    )
    lines = [",".join(_csv_escape(c) for c in cols)]
    for row in ds.rows:
        lines.append(",".join(_csv_escape(v) for v in row))
    return name, GeneratedFile(name=f"src/test/resources/{name}", content="\n".join(lines) + "\n")


# --- Сборка -------------------------------------------------------------------------

def generate_gatling(scenario: ScenarioDraft) -> GatlingResult:
    groups = _group(scenario)
    datasets = {d.id: d for d in scenario.datasets}
    load = scenario.load
    autostop = scenario.autostop
    autostop_on = bool(autostop.enabled) and (
        autostop.error_rate_pct > 0 or autostop.avg_response_ms > 0
    )

    feeder_params = _feeder_params(scenario)
    feeder_names = set(feeder_params.keys())
    need_random_string = any(_random_string_params(r) for r in scenario.requests)

    files: list[GeneratedFile] = []
    feeder_decls: list[str] = []
    used_ds: list[str] = []
    for _members, ds_ids in groups:
        for dsid in ds_ids:
            if dsid in datasets and dsid not in used_ds:
                used_ds.append(dsid)
    for dsid in used_ds:
        ds = datasets[dsid]
        if not ds.columns and not ds.rows:
            continue
        csv_name, gf = _dataset_file(ds)
        files.append(gf)
        strategy = "random()" if ds.random else "circular()"
        feeder_decls.append(
            f"    private static final FeederBuilder<String> FEEDER_{_java_id(dsid).upper()} ="
            f"\n            csv({_java(csv_name)}).{strategy};"
        )

    request_names = _unique_request_names(scenario.requests)
    scenario_blocks: list[str] = []
    setup_entries: list[str] = []
    smoke_entries: list[str] = []
    total_duration = 0
    for idx, (members, ds_ids) in enumerate(groups):
        key = f"group{idx}"
        uses_feeder = any(
            p.name in feeder_names
            for m in members
            for p in m.params
        )
        scenario_blocks.append(
            _emit_scenario(key, members, ds_ids, datasets, uses_feeder, autostop_on, request_names)
        )
        scenario_blocks.append(
            _emit_scenario(
                key + "Smoke", members, ds_ids, datasets, uses_feeder, False, request_names
            )
        )
        smoke_entries.append(
            f"                {key}Smoke.injectOpen(\n"
            f"                    constantUsersPerSec(1).during(Duration.ofSeconds(SMOKE_SEC))\n"
            f"                ).protocols(httpProtocol)"
        )
        samples = _samples_per_iteration(members)
        arg_indent = " " * 20
        steps, duration = _injection(members[0].intensity, load, samples, arg_indent)
        total_duration = max(total_duration, duration)
        http_peak = max(0.0, float(members[0].intensity.target_rps))
        comment = (
            f"            // {samples} HTTP/итерацию · "
            f"{_d(_arrival_of(http_peak, samples))} итер/с ≈ {_d(http_peak)} HTTP/с"
        )
        injected = (",\n" + arg_indent).join(steps)
        setup_entries.append(
            f"{comment}\n            {key}.injectOpen(\n{arg_indent}{injected}\n"
            f"            ).protocols(httpProtocol)"
        )

    imports = [
        "import static io.gatling.javaapi.core.CoreDsl.*;",
        "import static io.gatling.javaapi.http.HttpDsl.*;",
        "",
        "import io.gatling.javaapi.core.FeederBuilder;",
        "import io.gatling.javaapi.core.ScenarioBuilder;",
        "import io.gatling.javaapi.core.Session;",
        "import io.gatling.javaapi.core.Simulation;",
        "import io.gatling.javaapi.http.HttpProtocolBuilder;",
        "import java.time.Duration;",
        "import java.util.ArrayDeque;",
        "import java.util.Deque;",
        "import java.util.HashMap;",
        "import java.util.Iterator;",
        "import java.util.Map;",
        "import java.util.concurrent.ThreadLocalRandom;",
        "import java.util.concurrent.atomic.AtomicLong;",
    ]

    parts: list[str] = []
    parts.append(f"package {SIMULATION_PACKAGE};")
    parts.append("\n".join(imports))
    parts.append(
        "/**\n"
        " * Сгенерировано порталом подготовки сценариев нагрузки (движок Gatling).\n"
        " *\n"
        " * Целевой RPS группы — HTTP-сэмплы/с. Открытая модель: usersPerSec = RPS / число\n"
        " * HTTP за итерацию, поэтому суммарный поток совпадает с JMeter и k6.\n"
        " * loadFactor (доля шарда) умножает интенсивности в load. smoke — 1 итер/с на группу.\n"
        " */\n"
        f"public class {SIMULATION_CLASS} extends Simulation {{"
    )
    parts.append(
        f"    private static final String BASE_URL = System.getProperty(\"baseUrl\", {_java(scenario.base_url or '')});\n"
        "    private static final String MODE = System.getProperty(\"lt.mode\", \"load\");\n"
        "    private static final boolean SMOKE = \"smoke\".equals(MODE);\n"
        "    private static final long SMOKE_SEC = Long.getLong(\"lt.smokeDurationSec\", 60L);\n"
        "    private static final double LOAD_FACTOR = Double.parseDouble(System.getProperty(\"loadFactor\", \"1.0\"));\n"
        "\n"
        "    static {\n"
        "        if (!\"load\".equals(MODE) && !\"smoke\".equals(MODE)) {\n"
        "            throw new IllegalArgumentException(\n"
        "                    \"неизвестный lt.mode=\" + MODE + \" (ожидается load или smoke)\");\n"
        "        }\n"
        "    }"
    )
    if autostop_on:
        parts.append(
            f"    private static final String AUTOSTOP_MESSAGE = {_java('AutoStop: деградация за окном наблюдения')};"
        )
    parts.append(
        "    private final HttpProtocolBuilder httpProtocol = http\n"
        "            .baseUrl(BASE_URL)\n"
        '            .acceptHeader("*/*")\n'
        '            .userAgentHeader("loadtest-portal/gatling");'
    )
    generated_values = _generated_values_block(feeder_params, need_random_string)
    if generated_values:
        parts.append(generated_values)
    if feeder_decls:
        parts.append("\n\n".join(feeder_decls))
    if autostop_on:
        parts.append(_autostop_block(autostop))
    parts.extend(scenario_blocks)

    def _pad(text: str, n: int = 4) -> str:
        pad = " " * n
        return "\n".join((pad + line) if line.strip() else line for line in text.split("\n"))

    load_asserts = _assertions(autostop) if autostop_on else []
    smoke_asserts = _smoke_assertions(scenario.requests, request_names)
    setup_lines = ["    {", "        if (SMOKE) {", "            setUp("]
    setup_lines.append(",\n".join(smoke_entries) if smoke_entries else "                // нет групп")
    setup_lines.append("            )")
    if smoke_asserts:
        setup_lines.append("                    .assertions(")
        setup_lines.append(",\n".join(f"                            {a}" for a in smoke_asserts))
        setup_lines.append("                    )")
    setup_lines.append("                    .maxDuration(Duration.ofSeconds(SMOKE_SEC + 60));")
    setup_lines.append("        } else {")
    setup_lines.append("            setUp(")
    setup_lines.append(",\n".join(_pad(e) for e in setup_entries) if setup_entries else "                // нет групп")
    setup_lines.append("            )")
    if load_asserts:
        setup_lines.append("                    .assertions(")
        setup_lines.append(",\n".join(f"                            {a}" for a in load_asserts))
        setup_lines.append("                    )")
    setup_lines.append(
        f"                    .maxDuration(Duration.ofSeconds({max(60, total_duration + 120)}));"
    )
    setup_lines.append("        }")
    setup_lines.append("    }")
    parts.append("\n".join(setup_lines))
    parts.append("}")

    simulation = "\n\n".join(parts) + "\n"
    files.insert(
        0,
        GeneratedFile(
            name=f"src/test/java/{SIMULATION_PACKAGE}/{SIMULATION_CLASS}.java",
            content=simulation,
        ),
    )
    files.insert(0, GeneratedFile(name="pom.xml", content=_pom(scenario)))
    files.append(
        GeneratedFile(name="src/test/resources/gatling.conf", content=_gatling_conf(scenario))
    )
    files.append(GeneratedFile(name="README.md", content=_readme(scenario, autostop_on)))

    base_name = re.sub(r"[^a-zA-Z0-9_.-]", "_", scenario.name or "scenario") or "scenario"
    return GatlingResult(filename=base_name, files=files)


def _pom(scenario: ScenarioDraft) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <groupId>com.loadtest</groupId>
    <artifactId>portal-gatling</artifactId>
    <version>1.0.0</version>
    <packaging>jar</packaging>

    <properties>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
        <maven.compiler.release>{JAVA_RELEASE}</maven.compiler.release>
        <gatling.version>{GATLING_VERSION}</gatling.version>
        <gatling-maven-plugin.version>{GATLING_MAVEN_PLUGIN_VERSION}</gatling-maven-plugin.version>
    </properties>

    <dependencies>
        <dependency>
            <groupId>io.gatling.highcharts</groupId>
            <artifactId>gatling-charts-highcharts</artifactId>
            <version>${{gatling.version}}</version>
            <scope>test</scope>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>io.gatling</groupId>
                <artifactId>gatling-maven-plugin</artifactId>
                <version>${{gatling-maven-plugin.version}}</version>
                <configuration>
                    <simulationClass>{SIMULATION_PACKAGE}.{SIMULATION_CLASS}</simulationClass>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>
"""


def _hocon_string(value: str) -> str:
    return (
        '"'
        + str(value).replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ").replace("\r", "")
        + '"'
    )


def _gatling_conf(scenario: ScenarioDraft) -> str:
    run_id = scenario.prometheus.run_id or "1"
    description = f"portal runId={run_id} scenario={scenario.name or 'scenario'}"
    return f"""# Конфигурация Gatling для этого прогона.
# Real-time экспорта в OSS нет: Graphite удалён в 3.12, InfluxDB/OTel — Enterprise.
gatling {{
  core {{
    runDescription = {_hocon_string(description)}
  }}
  data {{
    writers = [console, file]
  }}
}}
"""


def _readme(scenario: ScenarioDraft, autostop_on: bool) -> str:
    autostop_note = (
        "AutoStop включён: скользящее окно по доле KO и среднему отклику. Критерий "
        "проверяется только после того, как окно набралось целиком, и при пробитии "
        "`crashLoadGeneratorIf` рвёт прогон с ненулевым кодом выхода. "
        "Итоговый вердикт дополнительно закреплён в `assertions`. "
        "В режиме smoke эта цепочка не исполняется: ошибки режет раннер."
        if autostop_on
        else "AutoStop выключен: тест идёт до конца профиля (ограничен `maxDuration`)."
    )
    return f"""# {scenario.name or 'scenario'} — Gatling

Сгенерировано порталом подготовки сценариев нагрузки.

## Запуск

```bash
mvn -q gatling:test
```

Локальный smoke (10 с, без CI):

```bash
mvn gatling:test -Dlt.mode=smoke -Dlt.smokeDurationSec=10
```

Требуется JDK {JAVA_RELEASE}+ и Maven. Gatling {GATLING_VERSION} подтянется как зависимость.
HTML-отчёт — в `target/gatling/<simulation>-<timestamp>/index.html`.

## Запуск в CI

Раннер (`lt-run`) передаёт system properties. Без них скрипт работает как load
с `loadFactor=1.0` и `baseUrl` из сценария.

| Смысл | Свойство | По умолчанию |
|---|---|---|
| режим | `lt.mode` = `load` / `smoke` | `load` |
| длительность smoke | `lt.smokeDurationSec` | `60` |
| доля шарда | `loadFactor` (double, 1/N) | `1.0` |
| шард | `shard` / `shards` | не читается скриптом |
| базовый URL | `baseUrl` | URL сценария |
| метка прогона | `runId` | раннер перекрывает `runDescription` |

В smoke каждая группа идёт `constantUsersPerSec(1)` всю длительность: одна итерация
проходит все запросы группы (repeat, корреляция, датасеты). Ramp, ступени и
`loadFactor` не применяются, AutoStop выключен. Если запрос ни разу не выполнился,
падает assertion `details(имя).allRequests().count().gt(0)`.

k6 из того же портала: `k6 run -e LT_MODE=smoke -e LT_SMOKE_DURATION_SEC=10 script.js`.

## Модель нагрузки

Целевой RPS в портале — **HTTP-запросы в секунду**. Gatling инжектит пользователей
(итерации), поэтому портал делит: `usersPerSec = RPS / число HTTP за итерацию`.
Так суммарный поток совпадает с JMeter (Throughput Shaping Timer) и k6.

`throttle` намеренно не используется: официальная документация Gatling допускает его
только для однозапросных сценариев, иначе распределение между запросами перекашивается.

- постоянная нагрузка — `rampUsersPerSec(...).to(...)` + `constantUsersPerSec(...).randomized()`;
- поиск максимума — `incrementUsersPerSec(...).times(N).eachLevelLasting(...)`: ровные полки
  без ramp между ступенями.

## Метрики

Gatling OSS пишет `console` + `file` (`simulation.log`) и собирает HTML-отчёт.
Метка прогона (`runId`) уходит в `runDescription` в `src/test/resources/gatling.conf`.

## AutoStop

{autostop_note}

## Значения параметров

- `uuid`, `randomInt`, `timestamp` — Gatling EL, пересчитываются на каждый запрос;
- `randomString` — новое значение перед каждым HTTP (как `__RandomString` в JMeter);
- `counter` — фидер, одно значение на итерацию сценария; общий на всех пользователей
  (в JMeter `per_user=true` даёт отдельный счётчик на поток, здесь значения не
  повторяются между пользователями);
- CSV-датасеты — `src/test/resources/*.csv`, стратегия `circular` или `random`.
"""
