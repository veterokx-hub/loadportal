import type { Scenario, SourceType } from "./types";
import type { AuthSession, UserRole } from "./auth";
import { authHeaders, clearSession } from "./auth";

const BASE =
  process.env.NEXT_PUBLIC_CORE_API_BASE_URL ?? "http://localhost:8080";

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

export interface LdapSettings {
  ldap_enabled: boolean;
  ldap_url: string;
  ldap_base_dn: string;
  ldap_user_dn_pattern: string;
  ldap_user_search_base: string;
  ldap_user_search_filter: string;
  ldap_bind_dn: string;
  ldap_bind_password: string;
}

export interface GitLabSettings {
  gitlab_base_url: string;
  gitlab_project_id: string;
  gitlab_repository: string;
  gitlab_trigger_token: string;
  gitlab_upload_token: string;
  gitlab_webhook_secret: string;
  grafana_base_url: string;
  grafana_dashboard_template: string;
}

export interface GitLabRunDefaults {
  gitlab_repository: string;
  configured: boolean;
}

export interface GitLabTestResult {
  ok: boolean;
  message: string;
  project_id?: number | null;
  project_path?: string | null;
}

export interface TestRunEvent {
  at: string;
  event: string;
  detail: string;
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
  engine: "jmeter" | "k6"
): Promise<BuildSaveResult> {
  const res = await fetch(`${BASE}/api/builds/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ scenario, engine }),
  });
  await ensureOk(res);
  return res.json();
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

export async function getLdapSettings(): Promise<LdapSettings> {
  const res = await fetch(`${BASE}/api/settings/ldap`, { headers: { ...authHeaders() } });
  await ensureOk(res);
  return res.json();
}

export async function saveLdapSettings(body: LdapSettings): Promise<LdapSettings> {
  const res = await fetch(`${BASE}/api/settings/ldap`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  await ensureOk(res);
  return res.json();
}

export async function getGitLabSettings(): Promise<GitLabSettings> {
  const res = await fetch(`${BASE}/api/settings/gitlab`, { headers: { ...authHeaders() } });
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

export async function saveGitLabSettings(body: GitLabSettings): Promise<GitLabSettings> {
  const res = await fetch(`${BASE}/api/settings/gitlab`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  await ensureOk(res);
  return res.json();
}

export async function testGitLabConnection(): Promise<GitLabTestResult> {
  const res = await fetch(`${BASE}/api/settings/gitlab/test`, {
    method: "POST",
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

export async function createRun(body: CreateTestRunBody): Promise<TestRun> {
  const res = await fetch(`${BASE}/api/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  await ensureOk(res);
  return res.json();
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
      return "Требуется авторизация — войдите снова";
    case 403:
      return "Недостаточно прав для этого действия";
    case 404:
      return "Ресурс не найден";
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
