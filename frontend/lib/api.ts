import type { Scenario, SourceType } from "./types";
import type { Engine } from "./engines";
import type { AuthSession, UserRole } from "./auth";
import { authHeaders, clearSession } from "./auth";

/** Same-origin /api — Next.js rewrites на constructor / orchestrator. */
const BASE = process.env.NEXT_PUBLIC_CORE_API_BASE_URL ?? "";

/** Событие: токен протух / сессия сброшена на сервере. */
export const AUTH_EXPIRED_EVENT = "ltp-auth-expired";

function notifyAuthExpired() {
  clearSession();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }
}

async function ensureOk(res: Response): Promise<void> {
  if (res.status === 401) {
    notifyAuthExpired();
  }
  if (!res.ok) {
    throw new Error(await errorText(res));
  }
}

export interface AnalyzeInput {
  source_type: SourceType;
  url?: string;
  content?: string;
  name?: string;
}

export interface BuildHistoryItem {
  id: string;
  scenario_name: string;
  engine: string;
  filename: string;
  created_at: string;
}

export interface PortalUser {
  username: string;
  role: UserRole;
  enabled: boolean;
  ldap_only: boolean;
}

export interface GitLabRunDefaults {
  gitlab_repository: string;
  configured: boolean;
}

export interface TestRunEvent {
  at: string;
  event: string;
  detail: string;
}

export interface RunVerdict {
  status: string;
  samples?: number | null;
  p95_ms?: number | null;
  p99_ms?: number | null;
  error_rate_pct?: number | null;
  rps?: number | null;
  reasons?: string[];
}

export interface TestRun {
  id: string;
  test_id?: string;
  username: string;
  scenario_name: string;
  engine: string;
  build_id?: string | null;
  script_id?: string | null;
  target_url: string;
  /** Идентификация сервиса в кластере — вход модуля «Анализ». */
  target_cluster?: string;
  target_namespace?: string;
  target_service?: string;
  target_container?: string;
  params: Record<string, unknown>;
  labels: Record<string, string>;
  status: string;
  gitlab_pipeline_id?: number | null;
  gitlab_web_url?: string;
  grafana_url?: string;
  started_at?: string | null;
  ended_at?: string | null;
  error_message?: string;
  created_at: string;
  events: TestRunEvent[];
  verdict?: RunVerdict | null;
}

export interface CreateTestRunBody {
  test_id: string;
  build_id?: string;
  script_id?: string;
  scenario_name?: string;
  engine?: string;
  target_url?: string;
  start_time?: string;
  end_time?: string;
  cpu?: string;
  memory?: string;
  scenario_path?: string;
  pod_name?: string;
  repository?: string;
  target_cluster?: string;
  target_namespace?: string;
  target_service?: string;
  target_container?: string;
  params?: Record<string, unknown>;
  labels?: Record<string, string>;
}

export interface ScriptSummary {
  id: string;
  build_id?: string | null;
  engine: string;
  filename: string;
  source: string;
  git_url?: string;
  created_at: string;
}

export interface BuildSaveResult {
  build_id: string;
  script_id: string;
  scenario_name: string;
  engine: string;
  filename: string;
}

export async function login(username: string, password: string): Promise<AuthSession> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(await errorText(res));
  const data = await res.json();
  return {
    token: data.token,
    username: data.username,
    role: data.role,
    mustChangePassword: Boolean(data.must_change_password),
  };
}

/** Проверяет, что Bearer из localStorage ещё валиден на сервере. */
export async function validateSession(): Promise<boolean> {
  const headers = authHeaders();
  if (!headers.Authorization) return false;
  try {
    const res = await fetch(`${BASE}/api/auth/me`, { headers: { ...headers } });
    if (res.status === 401) {
      notifyAuthExpired();
      return false;
    }
    return res.ok;
  } catch {
    return false;
  }
}

export async function changeOwnPassword(
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const res = await fetch(`${BASE}/api/auth/change-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  });
  await ensureOk(res);
}

export async function logoutApi(): Promise<void> {
  await fetch(`${BASE}/api/auth/logout`, {
    method: "POST",
    headers: { ...authHeaders() },
  }).catch(() => {});
}

export interface AuthSessionInfo {
  id: string;
  created_at: string;
  expires_at: string;
  current: boolean;
}

export async function listSessions(): Promise<AuthSessionInfo[]> {
  const res = await fetch(`${BASE}/api/auth/sessions`, {
    headers: { ...authHeaders() },
  });
  await ensureOk(res);
  return res.json();
}

export async function revokeSession(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/auth/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { ...authHeaders() },
  });
  await ensureOk(res);
}

export async function logoutAllApi(): Promise<void> {
  await fetch(`${BASE}/api/auth/logout-all`, {
    method: "POST",
    headers: { ...authHeaders() },
  }).catch(() => {});
}

export async function setUserPassword(username: string, password: string): Promise<void> {
  const res = await fetch(`${BASE}/api/users/${encodeURIComponent(username)}/password`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ password }),
  });
  await ensureOk(res);
}

export async function analyze(input: AnalyzeInput): Promise<Scenario> {
  const res = await fetch(`${BASE}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(input),
  });
  await ensureOk(res);
  return res.json();
}

export interface BuildResult {
  blob: Blob;
  filename: string;
}

export async function saveBuild(
  scenario: Scenario,
  engine: Engine
): Promise<BuildSaveResult> {
  const res = await fetch(`${BASE}/api/builds/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ scenario, engine }),
  });
  await ensureOk(res);
  return res.json();
}

/** Разовая генерация без записи в историю сборок (POST /api/build[/k6|/gatling]). */
const BUILD_PATH: Record<Engine, string> = {
  jmeter: "/api/build",
  k6: "/api/build/k6",
  gatling: "/api/build/gatling",
};

const BUILD_FALLBACK_FILENAME: Record<Engine, string> = {
  jmeter: "scenario.jmx",
  k6: "scenario.zip",
  gatling: "scenario.zip",
};

export async function generateScript(
  scenario: Scenario,
  engine: Engine
): Promise<BuildResult> {
  const res = await fetch(`${BASE}${BUILD_PATH[engine]}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(scenario),
  });
  await ensureOk(res);
  const fromHeader = filenameFromContentDisposition(res.headers.get("Content-Disposition"));
  return { blob: await res.blob(), filename: fromHeader || BUILD_FALLBACK_FILENAME[engine] };
}

export async function listScripts(): Promise<ScriptSummary[]> {
  const res = await fetch(`${BASE}/api/scripts`, { headers: { ...authHeaders() } });
  await ensureOk(res);
  return res.json();
}

export async function uploadScript(
  file: File,
  engine?: string,
  gitUrl?: string
): Promise<ScriptSummary> {
  const form = new FormData();
  form.append("file", file);
  if (engine) form.append("engine", engine);
  if (gitUrl) form.append("git_url", gitUrl);
  const res = await fetch(`${BASE}/api/scripts/upload`, {
    method: "POST",
    headers: { ...authHeaders() },
    body: form,
  });
  await ensureOk(res);
  return res.json();
}

/** Имя файла из Content-Disposition (filename / filename*). */
function filenameFromContentDisposition(cd: string | null): string | null {
  if (!cd) return null;
  const star = cd.match(/filename\*\s*=\s*(?:UTF-8''|utf-8'')([^;]+)/i);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^["']|["']$/g, ""));
    } catch {
      /* ignore malformed */
    }
  }
  const plain = cd.match(/filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)/i);
  const raw = (plain?.[1] ?? plain?.[2] ?? "").trim();
  return raw || null;
}

/**
 * Скачивает ровно те байты, что сохранены под script_id и уйдут в прогон.
 * @param fallbackFilename имя из ответа saveBuild — страховка, если CORS скрыл Content-Disposition
 */
export async function downloadScript(
  scriptId: string,
  fallbackFilename?: string
): Promise<BuildResult> {
  const res = await fetch(
    `${BASE}/api/scripts/${encodeURIComponent(scriptId)}/download`,
    { headers: { ...authHeaders() } }
  );
  await ensureOk(res);
  const fromHeader = filenameFromContentDisposition(res.headers.get("Content-Disposition"));
  const filename = fromHeader || fallbackFilename || "scenario.jmx";
  return { blob: await res.blob(), filename };
}

export async function listBuilds(): Promise<BuildHistoryItem[]> {
  const res = await fetch(`${BASE}/api/builds`, { headers: { ...authHeaders() } });
  await ensureOk(res);
  return res.json();
}

export async function loadBuildScenario(id: string): Promise<Scenario> {
  const res = await fetch(`${BASE}/api/builds/${id}/scenario`, {
    headers: { ...authHeaders() },
  });
  await ensureOk(res);
  return res.json();
}

export async function deleteBuild(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/builds/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { ...authHeaders() },
  });
  await ensureOk(res);
}

export async function listUsers(): Promise<PortalUser[]> {
  const res = await fetch(`${BASE}/api/users`, { headers: { ...authHeaders() } });
  await ensureOk(res);
  return res.json();
}

export async function createUser(body: {
  username: string;
  password: string;
  role: UserRole;
  ldap_only: boolean;
}): Promise<PortalUser> {
  const res = await fetch(`${BASE}/api/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  await ensureOk(res);
  return res.json();
}

export async function deleteUser(username: string): Promise<void> {
  const res = await fetch(`${BASE}/api/users/${encodeURIComponent(username)}`, {
    method: "DELETE",
    headers: { ...authHeaders() },
  });
  await ensureOk(res);
}

export async function setUserRole(username: string, role: UserRole): Promise<PortalUser> {
  const res = await fetch(`${BASE}/api/users/${encodeURIComponent(username)}/role`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ role }),
  });
  await ensureOk(res);
  return res.json();
}

export interface AuditEvent {
  id: string;
  created_at: string;
  username: string;
  action: string;
  detail: string;
}

export async function listAuditEvents(): Promise<AuditEvent[]> {
  const res = await fetch(`${BASE}/api/audit`, { headers: { ...authHeaders() } });
  await ensureOk(res);
  return res.json();
}

export async function getGitLabRunDefaults(): Promise<GitLabRunDefaults> {
  const res = await fetch(`${BASE}/api/settings/gitlab/defaults`, {
    headers: { ...authHeaders() },
  });
  await ensureOk(res);
  return res.json();
}

export async function listRuns(): Promise<TestRun[]> {
  const res = await fetch(`${BASE}/api/runs`, { headers: { ...authHeaders() } });
  await ensureOk(res);
  return res.json();
}

export async function getRun(id: string): Promise<TestRun> {
  const res = await fetch(`${BASE}/api/runs/${id}`, { headers: { ...authHeaders() } });
  await ensureOk(res);
  return res.json();
}

export async function cancelRun(id: string): Promise<TestRun> {
  const res = await fetch(`${BASE}/api/runs/${id}/cancel`, {
    method: "POST",
    headers: { ...authHeaders() },
  });
  await ensureOk(res);
  return res.json();
}

export async function createRun(body: CreateTestRunBody): Promise<TestRun> {
  const res = await fetch(`${BASE}/api/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  await ensureOk(res);
  return res.json();
}

/**
 * Обёртка для новых вызовов: единая обработка 401 и текста ошибки.
 * Пустой ответ (204 / DELETE) отдаётся как undefined — вызывающий типизирует его void.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  await ensureOk(res);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function errorText(res: Response): Promise<string> {
  try {
    const data = await res.json();
    const raw =
      (typeof data.error === "string" && data.error) ||
      (typeof data.detail === "string" && data.detail) ||
      (typeof data.title === "string" && data.title) ||
      (Array.isArray(data.detail)
        ? data.detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join("; ")
        : "") ||
      "";
    if (raw && !looksGarbled(raw)) return raw;
    return statusMessage(res.status);
  } catch {
    return statusMessage(res.status);
  }
}

/** Ответы без UTF-8 иногда приходят как «???????». */
function looksGarbled(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && /^[\s?]+$/.test(t.replace(/HTTP \d+/g, ""));
}

function statusMessage(status: number): string {
  switch (status) {
    case 401:
      return "Неверный логин или пароль / сессия истекла";
    case 403:
      return "Недостаточно прав для этого действия";
    case 404:
      return "Ресурс не найден";
    case 502:
    case 503:
      return "Сервис ещё не готов — подождите несколько секунд и обновите страницу";
    default:
      return `Ошибка сервера (HTTP ${status})`;
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  // octet-stream: иначе браузер подгоняет расширение под MIME (.jmx → .xml).
  const url = URL.createObjectURL(
    new Blob([blob], { type: "application/octet-stream" })
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
