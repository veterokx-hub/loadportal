/**
 * Модуль «Анализ»: типы контракта (зеркало analysis/app/models.py) и клиент к
 * orchestrator `/api/analysis`.
 *
 * Отчёт приходит snake_case как есть — переименовывать поля на границе значит
 * сверять два словаря при каждом изменении каталога правил.
 */
import { authHeaders } from "./auth";
import { apiFetch } from "./api";

export type Severity = "critical" | "major" | "minor" | "info";
export type Verdict = "healthy" | "degraded" | "unhealthy" | "inconclusive";
export type PhaseKind = "warmup" | "ramp" | "plateau" | "step" | "cooldown" | "idle";
export type DetectorKind = "level" | "drift" | "invariant" | "event" | "capacity";
export type TestKind = "ramp_hold" | "max_search" | "endurance";
export type AnalysisStatus = "queued" | "running" | "succeeded" | "failed";

export interface AnalysisTarget {
  cluster: string;
  namespace: string;
  service: string;
  container: string;
  runtime?: string;
  neighbors?: string[];
}

export interface LoadProfileInput {
  test_kind?: TestKind;
  target_rps?: number;
  ramp_up_sec?: number;
  hold_sec?: number;
  steps?: number;
  step_duration_sec?: number;
  slo_p90_ms?: number;
  slo_p99_ms?: number;
  slo_error_rate_pct?: number;
}

export interface Spark {
  t: number[];
  v: number[];
  unit: string;
  baseline?: number | null;
  limit?: number | null;
}

export interface Phase {
  kind: PhaseKind;
  from_ts: string;
  to_ts: string;
  rps: number;
  label: string;
  excluded: boolean;
}

export interface Evidence {
  observed?: number | null;
  baseline?: number | null;
  deviation_pct?: number | null;
  robust_z?: number | null;
  slope_per_hour?: number | null;
  slope_pct_per_hour?: number | null;
  kendall_tau?: number | null;
  p_value?: number | null;
  threshold?: number | null;
  breach_sec?: number | null;
  samples?: number | null;
  at_rps?: number | null;
  projection_hours?: number | null;
}

export interface Finding {
  id: string;
  detector: DetectorKind;
  severity: Severity;
  metric: string;
  metric_title: string;
  unit: string;
  phase?: PhaseKind | null;
  from_ts: string;
  to_ts: string;
  title: string;
  summary: string;
  next_step: string;
  evidence: Evidence;
  spark: Spark;
  confidence: number;
  query: string;
  labels: Record<string, string>;
}

export interface Correlation {
  id: string;
  finding_ids: string[];
  from_ts: string;
  to_ts: string;
  severity: Severity;
  title: string;
  chain: string[];
  summary: string;
  confidence: number;
}

export interface Hypothesis {
  id: string;
  pattern: string;
  title: string;
  body: string;
  checks: string[];
  confidence: number;
  severity: Severity;
  finding_ids: string[];
  correlation_id: string;
  source: string;
}

export interface Capacity {
  max_sustained_rps: number;
  knee_rps: number;
  knee_at?: string | null;
  first_limiter: string;
  first_limiter_title: string;
  reason: string;
}

export interface MetricCoverage {
  key: string;
  title: string;
  group: string;
  status: string;
  points: number;
}

export interface Coverage {
  requested: number;
  available: number;
  groups_ok: string[];
  groups_missing: string[];
  metrics: MetricCoverage[];
  score: number;
}

export interface Cost {
  queries: number;
  points_fetched: number;
  duration_ms: number;
  step_sec: number;
  refined_metrics: number;
  degraded: boolean;
  degraded_reason: string;
}

export interface Validity {
  valid: boolean;
  reasons: string[];
}

export interface AnalysisReport {
  run_id: string;
  test_id: string;
  ruleset_version: string;
  generated_at: string;
  window_from: string;
  window_to: string;
  target: AnalysisTarget;
  test_kind: TestKind;
  verdict: Verdict;
  headline: string;
  health_score: number;
  validity: Validity;
  phases: Phase[];
  findings: Finding[];
  correlations: Correlation[];
  hypotheses: Hypothesis[];
  capacity?: Capacity | null;
  coverage: Coverage;
  cost: Cost;
  suppressed: string[];
  demo: boolean;
}

export interface AnalysisRun {
  id: string;
  test_run_id?: string | null;
  test_id: string;
  username: string;
  target: AnalysisTarget;
  window_from: string;
  window_to: string;
  status: AnalysisStatus;
  verdict: Verdict | "";
  health_score: number;
  findings_count: number;
  headline: string;
  ruleset_version: string;
  demo: boolean;
  error_message: string;
  created_at: string;
  finished_at?: string | null;
  report?: AnalysisReport | null;
}

export interface CreateAnalysisBody {
  run_id?: string;
  test_id?: string;
  target?: AnalysisTarget;
  grafana_url?: string;
  window_from?: string;
  window_to?: string;
  profile?: LoadProfileInput;
  demo?: boolean;
  demo_fault?: string;
}

export interface TargetSuggestion {
  target: AnalysisTarget;
  window_from?: string | null;
  window_to?: string | null;
  dashboard_uid: string;
  matched: string[];
  unmatched: string[];
}

export interface CatalogEntry {
  key: string;
  title: string;
  group: string;
  unit: string;
  runtime: string;
  hint: string;
}

export interface AnalysisCatalog {
  ruleset_version: string;
  metrics: CatalogEntry[];
  patterns: string[];
}

// ————————————————————————— API —————————————————————————

export async function listAnalyses(runId?: string): Promise<AnalysisRun[]> {
  const qs = runId ? `?run_id=${encodeURIComponent(runId)}` : "";
  return apiFetch(`/api/analysis${qs}`, { headers: { ...authHeaders() } });
}

export async function getAnalysis(id: string): Promise<AnalysisRun> {
  return apiFetch(`/api/analysis/${id}`, { headers: { ...authHeaders() } });
}

export async function createAnalysis(body: CreateAnalysisBody): Promise<AnalysisRun> {
  return apiFetch("/api/analysis", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
}

export async function rerunAnalysis(id: string): Promise<AnalysisRun> {
  return apiFetch(`/api/analysis/${id}/rerun`, {
    method: "POST",
    headers: { ...authHeaders() },
  });
}

export async function deleteAnalysis(id: string): Promise<void> {
  await apiFetch(`/api/analysis/${id}`, { method: "DELETE", headers: { ...authHeaders() } });
}

export async function parseDashboardLink(url: string): Promise<TargetSuggestion> {
  return apiFetch("/api/analysis/parse-link", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ url }),
  });
}

export async function getAnalysisCatalog(): Promise<AnalysisCatalog> {
  return apiFetch("/api/analysis/catalog", { headers: { ...authHeaders() } });
}

// ————————————————————————— словари для UI —————————————————————————

export const VERDICT_META: Record<Verdict, { label: string; tone: string; pitch: string }> = {
  healthy: {
    label: "Всё чисто",
    tone: "ok",
    pitch: "Отклонений, на которые стоит смотреть, не нашлось.",
  },
  degraded: {
    label: "Есть к чему присмотреться",
    tone: "warn",
    pitch: "Тест прошёл, но сервис вёл себя не идеально.",
  },
  unhealthy: {
    label: "Так в прод нельзя",
    tone: "err",
    pitch: "Нашлось то, что сломается под реальной нагрузкой.",
  },
  inconclusive: {
    label: "Данных не хватило",
    tone: "muted",
    pitch: "Метрик слишком мало, чтобы делать выводы.",
  },
};

export const SEVERITY_META: Record<Severity, { label: string; tone: string; icon: string }> = {
  critical: { label: "Критично", tone: "err", icon: "!" },
  major: { label: "Важно", tone: "warn", icon: "▲" },
  minor: { label: "Мелочь", tone: "chain", icon: "•" },
  info: { label: "К сведению", tone: "muted", icon: "i" },
};

export const PHASE_META: Record<PhaseKind, { label: string; hint: string }> = {
  warmup: { label: "Прогрев", hint: "JIT компилирует, кэши пустые — находки здесь не в счёт" },
  ramp: { label: "Разгон", hint: "Нагрузка растёт: рост метрик здесь ожидаем" },
  plateau: { label: "Плато", hint: "Нагрузка постоянна — главная фаза для выводов" },
  step: { label: "Ступень", hint: "Ступень поиска максимума" },
  cooldown: { label: "Спад", hint: "Генератор остановлен: видно, отпустило ли сервис" },
  idle: { label: "Простой", hint: "Нагрузки нет" },
};

export const DETECTOR_META: Record<DetectorKind, { label: string; hint: string }> = {
  level: { label: "Сдвиг уровня", hint: "Метрика ушла от своей же медианы внутри фазы" },
  drift: { label: "Дрейф", hint: "Устойчивый тренд на постоянной нагрузке" },
  invariant: { label: "Правило", hint: "Нарушен порог из каталога или SLO сценария" },
  event: { label: "Событие", hint: "Рестарт, throttling, срабатывание autostop" },
  capacity: { label: "Ёмкость", hint: "Точка перелома в поиске максимума" },
};

export const TEST_KIND_META: Record<TestKind, { label: string; hint: string }> = {
  ramp_hold: { label: "Разгон и плато", hint: "Классический тест на заданной интенсивности" },
  max_search: { label: "Поиск максимума", hint: "Ступени вверх до отказа" },
  endurance: { label: "Надёжность", hint: "8–24 часа на постоянной нагрузке" },
};

export const ANALYSIS_STATUS_LABELS: Record<AnalysisStatus, string> = {
  queued: "В очереди",
  running: "Считает",
  succeeded: "Готов",
  failed: "Ошибка",
};

/** Профили дефектов демо-режима — чтобы можно было посмотреть модуль без кластера. */
export const DEMO_FAULTS = [
  { id: "leak", label: "Утечка памяти", hint: "Heap ползёт вверх на плато, GC не успевает" },
  { id: "pool", label: "Пул соединений", hint: "Очередь за коннектом к БД, хвост ответа уезжает" },
  { id: "throttle", label: "CPU throttling", hint: "Лимит контейнера режет вычисления" },
  { id: "clean", label: "Здоровый прогон", hint: "Ни одной находки — так выглядит норма" },
] as const;

export function severityTone(severity: Severity): string {
  return SEVERITY_META[severity]?.tone ?? "muted";
}

/** Единый формат чисел отчёта: юниты приходят из каталога метрик. */
/**
 * Зеркало `analysis/app/fmt.py`. Имена единиц берутся из каталога метрик как есть:
 * разъехавшиеся словари уже приводили к тому, что подпись спарклайна показывала
 * «0,0112» там, где текст находки говорил «19 мс».
 */
export function formatValue(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  switch (unit) {
    case "percent":
      return `${num(value)} %`;
    case "seconds":
      return Math.abs(value) < 1
        ? `${num(value * 1000, Math.abs(value * 1000) >= 10 ? 0 : undefined)} мс`
        : `${num(value)} с`;
    case "bytes":
      return bytes(value);
    case "cores":
      return Math.abs(value) < 1 ? `${num(value * 1000, 0)} мCPU` : `${num(value)} CPU`;
    case "rps":
      return `${num(value, 0)} RPS`;
    case "ratio":
      return `×${num(value)}`;
    case "count_per_sec":
      return `${num(value)}/с`;
    case "count":
      return num(value, 0);
    default:
      return num(value);
  }
}

function num(value: number, digits?: number): string {
  const magnitude = Math.abs(value);
  let d = digits;
  if (d === undefined) {
    if (magnitude >= 100) d = 0;
    else if (magnitude >= 10) d = 1;
    else if (magnitude >= 0.1 || magnitude === 0) d = 2;
    else d = Math.min(6, 2 - Math.floor(Math.log10(magnitude)));
  }
  return value.toFixed(d).replace(".", ",");
}

function bytes(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1024 ** 3) return `${num(value / 1024 ** 3, 2)} ГиБ`;
  if (abs >= 1024 ** 2) return `${num(value / 1024 ** 2, 2)} МиБ`;
  if (abs >= 1024) return `${num(value / 1024, 0)} КиБ`;
  return `${num(value, 0)} Б`;
}

export function formatWindow(from: string, to: string): string {
  const a = new Date(from);
  const b = new Date(to);
  const sameDay = a.toDateString() === b.toDateString();
  const date = a.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
  const t1 = a.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const t2 = b.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `${date}, ${t1} — ${t2}` : `${date} ${t1} — ${b.toLocaleDateString("ru-RU")} ${t2}`;
}

export function formatDurationSec(sec: number): string {
  if (sec < 60) return `${Math.round(sec)} с`;
  if (sec < 3600) return `${Math.floor(sec / 60)} мин`;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
}
