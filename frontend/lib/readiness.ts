import { groupIntensity, groupRequests } from "./grouping";
import {
  PARAM_LOCATION_LABEL,
  bracesIn,
  uiParams,
  valueInThisRequest,
} from "./request-params";
import {
  clashHint,
  clashMessage,
  gatlingScriptName,
  scriptVarClashes,
  scriptWriters,
} from "./script-vars";
import { plural } from "./plural";
import { formatRps, totalDuration } from "./profile";
import type { HealthFocus } from "./health-focus";
import type { ParamSource, RequestModel, Scenario } from "./types";

export type CheckSeverity = "error" | "warning" | "tip" | "ok";

export interface ReadinessCheck {
  id: string;
  severity: CheckSeverity;
  message: string;
  hint?: string;
  step?: number;
  requestId?: string;
  /** Куда прокрутить экран шага, чтобы поправить это сообщение. */
  focus?: Omit<HealthFocus, "token">;
}

export interface FlowNode {
  id: string;
  method: string;
  name: string;
  order: number;
  hasIssue: boolean;
  extractions: string[];
}

export interface FlowEdge {
  from: string;
  to: string;
  variable: string;
}

export interface ReadinessReport {
  score: number;
  label: string;
  pitch: string;
  peakRps: number;
  durationSec: number;
  requestCount: number;
  chainCount: number;
  checks: ReadinessCheck[];
  flow: { nodes: FlowNode[]; edges: FlowEdge[] };
  blockers: number;
  warnings: number;
}

const VAR_RE = /\$\{([a-zA-Z0-9_]+)\}/g;

function sourceEmpty(src: ParamSource): boolean {
  if (src.kind === "constant") return src.value.trim() === "";
  if (src.kind === "csv") return src.column.trim() === "";
  if (src.kind === "correlation") return src.variable.trim() === "";
  return false;
}

function varsFromPrior(requests: RequestModel[], beforeOrder: number): Set<string> {
  const out = new Set<string>();
  requests
    .filter((r) => r.order < beforeOrder)
    .forEach((r) =>
      r.extractions.forEach((e) => {
        const name = e.variable.trim();
        if (name) out.add(name);
      })
    );
  return out;
}

/** {param2} в адресе и ${param} в корреляции — разные имена, их легко спутать. */
function braceLookalike(req: RequestModel, variable: string): string | null {
  const names = [
    ...bracesIn(req.path ?? ""),
    ...bracesIn(req.url ?? ""),
    ...bracesIn(req.body?.content ?? ""),
  ];
  return (
    names.find((n) => n !== variable && (n.startsWith(variable) || variable.startsWith(n))) ??
    null
  );
}

function referencedVars(req: RequestModel): Set<string> {
  const vars = new Set<string>();
  const scan = (text?: string | null) => {
    if (!text) return;
    let m: RegExpExecArray | null;
    VAR_RE.lastIndex = 0;
    while ((m = VAR_RE.exec(text)) !== null) vars.add(m[1]);
  };
  req.params.forEach((p) => {
    if (p.source.kind === "correlation") {
      const name = p.source.variable.trim();
      if (name) vars.add(name);
    }
    else if (p.source.kind === "constant") scan(p.source.value);
  });
  scan(req.body?.content);
  scan(req.path);
  scan(req.url);
  return vars;
}

/**
 * Переменные, которые даёт CSV Data Set / колонки датасета запроса.
 * ${column} в теле/пути при источнике CSV — не корреляция и не блокер пульса.
 * Имя body/path-параметра с источником CSV тоже считается обеспеченным
 * (генератор подставит ${column} вместо {name}).
 */
function csvProvidedVars(req: RequestModel, scenario: Scenario): Set<string> {
  const out = new Set<string>();
  const ds = scenario.datasets.find((d) => d.id === req.dataset_id);
  ds?.columns.forEach((c) => {
    if (c) out.add(c);
  });
  req.params.forEach((p) => {
    if (p.source.kind !== "csv") return;
    if (p.source.column.trim()) out.add(p.source.column.trim());
    if (p.name.trim()) out.add(p.name.trim());
  });
  return out;
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec} с`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m} мин ${s} с` : `${m} мин`;
}

function scoreLabel(score: number): string {
  if (score >= 90) return "Готов к запуску";
  if (score >= 70) return "Почти готов";
  if (score >= 45) return "Требует внимания";
  return "Не готов";
}

/** Переменные, явно выбранные источником «Корреляция» (не CSV и не ${…} в теле). */
function explicitCorrelationVars(req: RequestModel): Set<string> {
  const vars = new Set<string>();
  for (const p of req.params) {
    if (p.source.kind === "correlation" && p.source.variable.trim()) {
      vars.add(p.source.variable.trim());
    }
  }
  return vars;
}

/**
 * Число связных компонент корреляции (экстрактор → явная корреляция в параметре).
 * Группы только по общему CSV сюда не входят.
 */
function countCorrelationChains(edges: FlowEdge[]): number {
  if (edges.length === 0) return 0;

  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let cur = id;
    if (!parent.has(cur)) parent.set(cur, cur);
    while (parent.get(cur) !== cur) {
      const p = parent.get(cur)!;
      parent.set(cur, parent.get(p) ?? p);
      cur = parent.get(cur)!;
    }
    return cur;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  edges.forEach((e) => union(e.from, e.to));

  const sizes = new Map<string, number>();
  for (const id of parent.keys()) {
    const root = find(id);
    sizes.set(root, (sizes.get(root) ?? 0) + 1);
  }
  let chains = 0;
  for (const size of sizes.values()) {
    if (size > 1) chains += 1;
  }
  return chains;
}

function place(
  step: number,
  focusPlace: HealthFocus["place"],
  extra: Partial<Omit<HealthFocus, "token" | "step" | "place">> = {}
): { step: number; focus: Omit<HealthFocus, "token"> } {
  return { step, focus: { step, place: focusPlace, ...extra } };
}

/** Где в сценарии встречается ${name}: параметр, тело или путь. */
function varFocus(
  req: RequestModel,
  name: string,
  requests: RequestModel[]
): { step: number; focus: Omit<HealthFocus, "token"> } {
  const needle = "${" + name + "}";
  const param = req.params.find((p) => {
    if (p.source.kind === "constant") return p.source.value.includes(needle);
    if (p.source.kind === "correlation") return p.source.variable.trim() === name;
    return false;
  });
  if (param) {
    return place(2, "param", { requestId: req.id, location: param.location, name: param.name });
  }
  if ((req.body?.content ?? "").includes(needle)) {
    return place(2, "body", { requestId: req.id, name });
  }
  if ((req.path ?? "").includes(needle) || (req.url ?? "").includes(needle)) {
    return place(1, "request-path", { requestId: req.id });
  }
  const prev = [...requests].reverse().find((r) => r.order < req.order);
  if (prev) return place(2, "extract", { requestId: prev.id, name });
  return place(2, "param", { requestId: req.id });
}

export function analyzeScenario(scenario: Scenario): ReadinessReport {
  const checks: ReadinessCheck[] = [];
  const requests = [...scenario.requests].sort((a, b) => a.order - b.order);
  const groups = groupRequests(scenario);
  const issueRequestIds = new Set<string>();

  const add = (c: ReadinessCheck) => {
    checks.push(c);
    if (c.severity === "error" && c.requestId) issueRequestIds.add(c.requestId);
  };

  if (requests.length === 0) {
    add({
      id: "no-requests",
      severity: "error",
      message: "В сценарии нет запросов",
      hint: "Импортируйте OpenAPI/Postman или добавьте запрос вручную",
      ...place(1, "add-request"),
    });
  }

  const withoutOwnUrl = requests.some((r) => !(r.url ?? "").trim());
  if (requests.length > 0 && !scenario.base_url.trim() && withoutOwnUrl) {
    add({
      id: "no-base-url",
      severity: "warning",
      message: "Не задан базовый URL",
      hint: "Укажите домен на шаге «Запросы» или собственный URL у каждого запроса",
      ...place(1, "base-url"),
    });
  }

  const extractedByReq = new Map<string, string[]>();
  const allExtracted = new Map<string, { reqId: string; order: number }>();

  requests.forEach((req) => {
    const vars = req.extractions.map((e) => e.variable).filter(Boolean);
    extractedByReq.set(req.id, vars);
    vars.forEach((v) => {
      if (!allExtracted.has(v)) allExtracted.set(v, { reqId: req.id, order: req.order });
    });
  });

  const writers = scriptWriters(scenario);
  scriptVarClashes(writers).forEach((c) => {
    c.writers.forEach((w, i) => {
      add({
        id: `svar-${c.name}-${i}`,
        severity: "warning",
        message: clashMessage(c),
        hint: clashHint(c),
        requestId: w.focus.requestId,
        step: w.focus.step,
        focus: w.focus,
      });
    });
  });
  writers.forEach((w, i) => {
    const renamed = gatlingScriptName(w.name);
    if (renamed === w.name) return;
    add({
      id: `svar-gatling-${i}-${w.name}`,
      severity: "warning",
      message: `Имя «${w.name}» в Gatling станет «${renamed}». В JMeter и k6 останется «${w.name}». (Gatling)`,
      hint: "Латинские буквы и цифры, первая — буква. Иначе Gatling переименует переменную",
      requestId: w.focus.requestId,
      step: w.focus.step,
      focus: w.focus,
    });
  });

  requests.forEach((req) => {
    const prior = varsFromPrior(requests, req.order);
    const fromCsv = csvProvidedVars(req, scenario);
    const reportedCorr = new Set<string>();

    uiParams(req).forEach((p) => {
      if (p.required && sourceEmpty(p.source)) {
        add({
          id: `req-param-${req.id}-${p.location}-${p.name}`,
          severity: "error",
          message: `«${req.name}»: не заполнен обязательный параметр ${p.name}`,
          hint: `Шаг «Корреляция и параметры», вкладка ${PARAM_LOCATION_LABEL[p.location] ?? p.location}`,
          requestId: req.id,
          ...place(2, "param", { requestId: req.id, location: p.location, name: p.name }),
        });
      }
      if (p.source.kind === "correlation") {
        const variable = p.source.variable.trim();
        const loc = PARAM_LOCATION_LABEL[p.location] ?? p.location;
        const who = `параметр «${p.name.trim() || "без имени"}» (${loc})`;
        const focus = place(2, "param", {
          requestId: req.id,
          location: p.location,
          name: p.name.trim(),
        });
        if (!variable) {
          add({
            id: `corr-${req.id}-${p.location}-${p.name}-empty`,
            severity: "error",
            message: `«${req.name}»: ${who} — источник «Корреляция», переменная не выбрана`,
            hint: "Выберите переменную из предыдущего запроса или смените источник",
            requestId: req.id,
            ...focus,
          });
        } else if (!prior.has(variable) && !fromCsv.has(variable)) {
          reportedCorr.add(variable);
          const same = req.extractions.some((e) => e.variable.trim() === variable);
          const later = requests.some(
            (r) =>
              r.order > req.order &&
              r.extractions.some((e) => e.variable.trim() === variable)
          );
          const lookalike = braceLookalike(req, variable);
          const hint = same
            ? "Извлечение на этом же запросе заполняется из ответа и в этот запрос не подставляется"
            : later
              ? "Извлечение стоит ниже по сценарию — к моменту этого запроса переменной ещё нет"
              : lookalike
                ? `{${lookalike}} в адресе и \${${variable}} — разные имена. Это источник параметра «${p.name.trim()}», не плейсхолдер пути`
                : "Смените источник этого параметра или добавьте извлечение с тем же именем в предыдущий запрос";
          add({
            id: `corr-${req.id}-${variable}`,
            severity: "error",
            message: `«${req.name}»: ${who} берёт \${${variable}}, выше её никто не извлекает`,
            hint,
            requestId: req.id,
            ...focus,
          });
        }
      }
      if (p.source.kind === "csv" && p.source.column) {
        const ds = scenario.datasets.find((d) => d.id === req.dataset_id);
        if (!ds) {
          add({
            id: `csv-no-ds-${req.id}-${p.name}`,
            severity: "warning",
            message: `«${req.name}»: CSV-колонка «${p.source.column}» без привязанного датасета`,
            requestId: req.id,
            ...place(2, "dataset", { requestId: req.id }),
          });
        } else if (!ds.columns.includes(p.source.column)) {
          add({
            id: `csv-col-${req.id}-${p.name}`,
            severity: "error",
            message: `«${req.name}»: в датасете «${ds.name}» нет колонки «${p.source.column}»`,
            requestId: req.id,
            ...place(2, "datasets", { name: ds.id }),
          });
        }
      }
    });

    referencedVars(req).forEach((v) => {
      // CSV Data Set / колонка параметра уже даёт ${v} в рантайме — это не блокер.
      // Значение, введённое параметром этого же запроса (строка под телом), тоже.
      if (prior.has(v) || fromCsv.has(v) || reportedCorr.has(v) || valueInThisRequest(req, v)) return;
      add({
        id: `var-${req.id}-${v}`,
        severity: "error",
        message: `«${req.name}»: переменная \${${v}} не извлечена ранее`,
        requestId: req.id,
        ...varFocus(req, v, requests),
      });
    });
  });

  // «Сиротские» экстракторы — извлекли, но нигде не используют
  const usedVars = new Set<string>();
  requests.forEach((r) => referencedVars(r).forEach((v) => usedVars.add(v)));
  requests.forEach((req) => {
    req.extractions.forEach((e) => {
      if (e.variable && !usedVars.has(e.variable)) {
        const later = requests.some((r) => r.order > req.order && referencedVars(r).has(e.variable));
        if (!later) {
          add({
            id: `orphan-${req.id}-${e.variable}`,
            severity: "warning",
            message: `«${req.name}»: \${${e.variable}} извлекается, но не используется`,
            hint: "Используйте её в следующих запросах или удалите извлечение",
            requestId: req.id,
            ...place(2, "extract", { requestId: req.id, name: e.variable }),
          });
        }
      }
    });
  });

  const peakRps = groups.reduce((acc, g) => acc + Math.max(0, groupIntensity(g).target_rps), 0);
  const durationSec = groups.reduce(
    (max, g) => Math.max(max, totalDuration(groupIntensity(g), scenario.load)),
    0
  );

  if (requests.length > 0 && peakRps <= 0) {
    add({
      id: "zero-rps",
      severity: "error",
      message: "Суммарная интенсивность — 0 RPS",
      ...place(3, "intensity"),
    });
  }

  if (!scenario.autostop.enabled && requests.length > 0) {
    add({
      id: "autostop-off",
      severity: "tip",
      message: "AutoStop выключен — тест не остановится при деградации",
      hint: "Включите на шаге «Интенсивность и сборка»",
      ...place(3, "autostop"),
    });
  }

  if (peakRps >= 500) {
    add({
      id: "high-rps",
      severity: "tip",
      message: `Высокая нагрузка: пик ${formatRps(peakRps)} RPS — убедитесь, что стенд выдержит`,
      ...place(3, "intensity"),
    });
  }

  // Поток / «цепочки»: только явный источник «Корреляция» у параметра.
  // Общий CSV и ${col} из датасета в теле/пути цепочками не считаются.
  const edges: FlowEdge[] = [];
  requests.forEach((req) => {
    explicitCorrelationVars(req).forEach((v) => {
      const owner = allExtracted.get(v);
      if (owner && owner.reqId !== req.id) {
        edges.push({ from: owner.reqId, to: req.id, variable: v });
      }
    });
  });
  const chainCount = countCorrelationChains(edges);

  const nodes: FlowNode[] = requests.map((req) => ({
    id: req.id,
    method: req.method,
    name: req.name,
    order: req.order,
    hasIssue: issueRequestIds.has(req.id),
    extractions: extractedByReq.get(req.id) ?? [],
  }));

  const blockers = checks.filter((c) => c.severity === "error").length;
  const warnings = checks.filter((c) => c.severity === "warning").length;

  let score = 100;
  score -= blockers * 18;
  score -= warnings * 6;
  score -= checks.filter((c) => c.severity === "tip").length * 1;
  score = Math.max(0, Math.min(100, score));
  if (requests.length === 0) score = 0;

  const host = scenario.base_url.trim() || "целевой API";
  const mode =
    scenario.load.test_mode === "max_search"
      ? `поиск максимума (ступеней: ${scenario.load.steps})`
      : "ramp-hold";
  const pitch =
    requests.length === 0
      ? "Сценарий пуст — импортируйте спецификацию или добавьте запросы."
      : `Нагрузочный сценарий «${scenario.name}» (${host}): запросов — ${requests.length}, ` +
        `пик ${formatRps(peakRps)} RPS, длительность ~${formatDuration(durationSec)}, режим ${mode}` +
        (chainCount > 0
          ? `, ${chainCount} ${plural(chainCount, "цепочка", "цепочки", "цепочек")} корреляции`
          : "") +
        ".";

  if (blockers === 0 && warnings === 0 && requests.length > 0) {
    checks.unshift({
      id: "all-good",
      severity: "ok",
      message: "Ошибок и предупреждений нет — можно собирать",
      ...place(3, "intensity"),
    });
  }

  return {
    score,
    label: scoreLabel(score),
    pitch,
    peakRps,
    durationSec,
    requestCount: requests.length,
    chainCount,
    checks,
    flow: { nodes, edges },
    blockers,
    warnings,
  };
}
