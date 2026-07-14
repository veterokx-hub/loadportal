import type { Scenario, SourceType } from "./types";
import type { AuthSession, UserRole } from "./auth";
import { authHeaders } from "./auth";

const BASE =
  process.env.NEXT_PUBLIC_CORE_API_BASE_URL ?? "http://localhost:8080";

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

export interface InfrastructureSettings {
  consul_enabled: boolean;
  consul_host: string;
  consul_port: number;
  consul_datacenter: string;
  consul_kv_prefix: string;
  consul_service_analyzer: string;
  consul_service_k6: string;
  consul_service_jmeter: string;
  analyzer_url: string;
  k6_generator_url: string;
  jmeter_builder_url: string;
  resolved_analyzer_url: string;
  resolved_k6_generator_url: string;
  resolved_jmeter_builder_url: string;
  consul_reachable: boolean;
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
  if (!res.ok) throw new Error(await errorText(res));
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
  if (!res.ok) throw new Error(await errorText(res));
  return res.json();
}

export interface BuildResult {
  blob: Blob;
  filename: string;
}

export async function buildJmx(scenario: Scenario): Promise<BuildResult> {
  return buildTo(`${BASE}/api/build`, scenario, "scenario.jmx");
}

export async function buildK6(scenario: Scenario): Promise<BuildResult> {
  return buildTo(`${BASE}/api/build/k6`, scenario, "scenario.js");
}

async function buildTo(
  endpoint: string,
  scenario: Scenario,
  singleFileFallback: string
): Promise<BuildResult> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(scenario),
  });
  if (!res.ok) throw new Error(await errorText(res));
  const cd = res.headers.get("Content-Disposition") ?? "";
  const match = cd.match(/filename="?([^"]+)"?/);
  const fallback = res.headers.get("Content-Type")?.includes("zip")
    ? "scenario.zip"
    : singleFileFallback;
  return { blob: await res.blob(), filename: match?.[1] ?? fallback };
}

export async function listBuilds(): Promise<BuildHistoryItem[]> {
  const res = await fetch(`${BASE}/api/builds`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(await errorText(res));
  return res.json();
}

export async function loadBuildScenario(id: string): Promise<Scenario> {
  const res = await fetch(`${BASE}/api/builds/${id}/scenario`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(await errorText(res));
  return res.json();
}

export async function listUsers(): Promise<PortalUser[]> {
  const res = await fetch(`${BASE}/api/users`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(await errorText(res));
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
  if (!res.ok) throw new Error(await errorText(res));
  return res.json();
}

export async function deleteUser(username: string): Promise<void> {
  const res = await fetch(`${BASE}/api/users/${encodeURIComponent(username)}`, {
    method: "DELETE",
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(await errorText(res));
}

export async function getLdapSettings(): Promise<LdapSettings> {
  const res = await fetch(`${BASE}/api/settings/ldap`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(await errorText(res));
  return res.json();
}

export async function saveLdapSettings(body: LdapSettings): Promise<LdapSettings> {
  const res = await fetch(`${BASE}/api/settings/ldap`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorText(res));
  return res.json();
}

export async function getInfrastructureSettings(): Promise<InfrastructureSettings> {
  const res = await fetch(`${BASE}/api/settings/infrastructure`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(await errorText(res));
  return res.json();
}

export async function saveInfrastructureSettings(
  body: InfrastructureSettings
): Promise<InfrastructureSettings> {
  const res = await fetch(`${BASE}/api/settings/infrastructure`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorText(res));
  return res.json();
}

async function errorText(res: Response): Promise<string> {
  try {
    const data = await res.json();
    return data.error ?? data.detail ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
