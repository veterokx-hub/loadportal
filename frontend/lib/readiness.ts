import { groupIntensity, groupRequests } from "./grouping";
import { uiParams } from "./request-params";
import { formatRps, totalDuration } from "./profile";
import type { ParamSource, RequestModel, Scenario } from "./types";

export type CheckSeverity = "error" | "warning" | "tip" | "ok";

export interface ReadinessCheck {
  id: string;
  severity: CheckSeverity;
  message: string;
  hint?: string;
  step?: number;
  requestId?: string;
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
    .forEach((r) => r.extractions.forEach((e) => e.variable && out.add(e.variable)));
  return out;
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
    if (p.source.kind === "correlation") vars.add(p.source.variable);
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
      step: 1,
    });
  }

  const withoutOwnUrl = requests.some((r) => !(r.url ?? "").trim());
  if (requests.length > 0 && !scenario.base_url.trim() && withoutOwnUrl) {
    add({
      id: "no-base-url",
      severity: "warning",
      message: "Не задан базовый URL",
      hint: "Укажите домен на шаге «Запросы» или собственный URL у каждого запроса",
      step: 1,
    });
  }

  const extractedByReq = new Map<string, string[]>();
  const allExtracted = new Map<string, { reqId: string; order: number }>();

  requests.forEach((req) => {
    const vars = req.extractions.map((e) => e.variable).filter(Boolean);
    extractedByReq.set(req.id, vars);
    const seen = new Set<string>();
    vars.forEach((v) => {
      if (seen.has(v)) {
        add({
          id: `dup-ext-${req.id}-${v}`,
          severity: "warning",
          message: `«${req.name}»: переменная «${v}» извлекается дважды`,
          step: 2,
          requestId: req.id,
        });
      }
      seen.add(v);
      if (!allExtracted.has(v)) allExtracted.set(v, { reqId: req.id, order: req.order });
    });
  });

  requests.forEach((req) => {
    const prior = varsFromPrior(requests, req.order);
    const fromCsv = csvProvidedVars(req, scenario);

    uiParams(req).forEach((p) => {
      if (p.required && sourceEmpty(p.source)) {
        add({
          id: `req-param-${req.id}-${p.location}-${p.name}`,
          severity: "error",
          message: `«${req.name}»: не заполнен обязательный параметр ${p.name}`,
          hint: `Параметр ${p.location} · ${p.name}`,
          step: 2,
          requestId: req.id,
        });
      }
      if (
        p.source.kind === "correlation" &&
        !prior.has(p.source.variable) &&
        !fromCsv.has(p.source.variable)
      ) {
        add({
          id: `corr-${req.id}-${p.source.variable}`,
          severity: "error",
          message: `«${req.name}»: корреляция \${${p.source.variable}} без извлечения выше`,
          hint: "Добавьте JSONPath/Regex на предыдущем запросе",
          step: 2,
          requestId: req.id,
        });
      }
      if (p.source.kind === "csv" && p.source.column) {
        const ds = scenario.datasets.find((d) => d.id === req.dataset_id);
        if (!ds) {
          add({
            id: `csv-no-ds-${req.id}-${p.name}`,
            severity: "warning",
            message: `«${req.name}»: CSV-колонка «${p.source.column}» без привязанного датасета`,
            step: 2,
            requestId: req.id,
          });
        } else if (!ds.columns.includes(p.source.column)) {
          add({
            id: `csv-col-${req.id}-${p.name}`,
            severity: "error",
            message: `«${req.name}»: колонка «${p.source.column}» отсутствует в «${ds.name}»`,
            step: 2,
            requestId: req.id,
          });
        }
      }
    });

    referencedVars(req).forEach((v) => {
      // CSV Data Set / колонка параметра уже даёт ${v} в рантайме — это не блокер.
      if (prior.has(v) || fromCsv.has(v)) return;
      add({
        id: `var-${req.id}-${v}`,
        severity: "error",
        message: `«${req.name}»: переменная \${${v}} не извлечена ранее`,
        step: 2,
        requestId: req.id,
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
            hint: "Проверьте корреляцию в следующих запросах",
            step: 2,
            requestId: req.id,
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
      message: "Суммарная целевая интенсивность равна 0 RPS",
      step: 3,
    });
  }

  if (!scenario.autostop.enabled && requests.length > 0) {
    add({
      id: "autostop-off",
      severity: "tip",
      message: "AutoStop выключен — тест не остановится при деградации",
      hint: "Включите на шаге «Интенсивность» для безопасного прогона",
      step: 3,
    });
  }

  if (peakRps >= 500) {
    add({
      id: "high-rps",
      severity: "tip",
      message: `Высокая нагрузка: пик ${peakRps} RPS — убедитесь, что стенд выдержит`,
      step: 3,
    });
  }

  const chainCount = groups.filter((g) => g.requests.length > 1).length;

  // Поток: узлы и рёбра корреляции
  const edges: FlowEdge[] = [];
  requests.forEach((req) => {
    referencedVars(req).forEach((v) => {
      const owner = allExtracted.get(v);
      if (owner && owner.reqId !== req.id) {
        edges.push({ from: owner.reqId, to: req.id, variable: v });
      }
    });
  });

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
      ? `поиск максимума (${scenario.load.steps} ступеней)`
      : "ramp-hold";
  const pitch =
    requests.length === 0
      ? "Сценарий пуст — импортируйте спецификацию, чтобы начать."
      : `Нагрузочный сценарий «${scenario.name}»: ${requests.length} запросов к ${host}, ` +
        `пик ${formatRps(peakRps)} RPS, длительность ~${formatDuration(durationSec)}, режим ${mode}` +
        (chainCount > 0 ? `, ${chainCount} цепоч${chainCount === 1 ? "ка" : chainCount < 5 ? "ки" : "ек"} корреляции` : "") +
        ".";

  if (blockers === 0 && warnings === 0 && requests.length > 0) {
    checks.unshift({
      id: "all-good",
      severity: "ok",
      message: "Критических замечаний нет — можно собирать артефакт",
      step: 3,
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
