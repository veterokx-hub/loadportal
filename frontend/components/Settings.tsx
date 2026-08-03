"use client";

import { useCallback, useEffect, useState } from "react";
import type { LdapSettings, PortalUser, GitLabSettings } from "@/lib/api";
import {
  createUser,
  deleteUser,
  getLdapSettings,
  getGitLabSettings,
  listUsers,
  saveLdapSettings,
  saveGitLabSettings,
  testGitLabConnection,
} from "@/lib/api";
import type { UserRole } from "@/lib/auth";

type SettingsTab = "users" | "ldap" | "gitlab";

const EMPTY_LDAP: LdapSettings = {
  ldap_enabled: false,
  ldap_url: "ldap://dc.corp.local:389",
  ldap_base_dn: "dc=corp,dc=local",
  ldap_user_dn_pattern: "uid={0},ou=people,dc=corp,dc=local",
  ldap_user_search_base: "ou=people,dc=corp,dc=local",
  ldap_user_search_filter: "(sAMAccountName={0})",
  ldap_bind_dn: "",
  ldap_bind_password: "",
};

const EMPTY_GITLAB: GitLabSettings = {
  gitlab_base_url: "https://gitlab.corp.local",
  gitlab_project_id: "",
  gitlab_trigger_ref: "main",
  gitlab_jmeter_variable: "LOADTEST_ENGINE=jmeter",
  gitlab_k6_variable: "LOADTEST_ENGINE=k6",
  gitlab_trigger_token_vault_path: "loadtest/gitlab/trigger-token",
  gitlab_webhook_secret_vault_path: "loadtest/gitlab/webhook-secret",
  grafana_base_url: "",
  grafana_dashboard_template: "/d/loadtest?var-run_id={run_id}&from={from}&to={to}",
};

export function Settings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<SettingsTab>("users");
  const [users, setUsers] = useState<PortalUser[]>([]);
  const [ldap, setLdap] = useState<LdapSettings>(EMPTY_LDAP);
  const [gitlab, setGitlab] = useState<GitLabSettings>(EMPTY_GITLAB);
  const [tabError, setTabError] = useState<{ tab: SettingsTab; message: string } | null>(null);
  const [tabHint, setTabHint] = useState<{ tab: SettingsTab; message: string } | null>(null);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingLdap, setLoadingLdap] = useState(false);
  const [loadingGitlab, setLoadingGitlab] = useState(false);
  const [testingGitlab, setTestingGitlab] = useState(false);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [ldapLoaded, setLdapLoaded] = useState(false);
  const [gitlabLoaded, setGitlabLoaded] = useState(false);

  const [newUser, setNewUser] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("USER");
  const [newLdapOnly, setNewLdapOnly] = useState(false);

  const switchTab = (next: SettingsTab) => {
    setTab(next);
    setTabError(null);
    setTabHint(null);
  };

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    setTabError(null);
    try {
      setUsers(await listUsers());
      setUsersLoaded(true);
    } catch (e) {
      setTabError({
        tab: "users",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  const loadLdap = useCallback(async () => {
    setLoadingLdap(true);
    setTabError(null);
    try {
      const l = await getLdapSettings();
      setLdap({ ...EMPTY_LDAP, ...l, ldap_bind_password: "" });
      setLdapLoaded(true);
    } catch (e) {
      setTabError({
        tab: "ldap",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoadingLdap(false);
    }
  }, []);

  const loadGitlab = useCallback(async () => {
    setLoadingGitlab(true);
    setTabError(null);
    try {
      const g = await getGitLabSettings();
      setGitlab({ ...EMPTY_GITLAB, ...g });
      setGitlabLoaded(true);
    } catch (e) {
      setTabError({
        tab: "gitlab",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoadingGitlab(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setTabError(null);
    setTabHint(null);
    setTab("users");
    setUsersLoaded(false);
    setLdapLoaded(false);
    setGitlabLoaded(false);
    loadUsers();
  }, [open, loadUsers]);

  useEffect(() => {
    if (!open || tab !== "ldap" || ldapLoaded) return;
    loadLdap();
  }, [open, tab, ldapLoaded, loadLdap]);

  useEffect(() => {
    if (!open || tab !== "gitlab" || gitlabLoaded) return;
    loadGitlab();
  }, [open, tab, gitlabLoaded, loadGitlab]);

  async function addUser() {
    setTabError(null);
    setTabHint(null);
    try {
      await createUser({
        username: newUser.trim(),
        password: newPass,
        role: newRole,
        ldap_only: newLdapOnly,
      });
      setUsers(await listUsers());
      setNewUser("");
      setNewPass("");
      setTabHint({ tab: "users", message: "Пользователь создан" });
    } catch (e) {
      setTabError({
        tab: "users",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function removeUser(username: string) {
    setTabError(null);
    setTabHint(null);
    try {
      await deleteUser(username);
      setUsers(await listUsers());
      setTabHint({ tab: "users", message: "Пользователь удалён" });
    } catch (e) {
      setTabError({
        tab: "users",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function saveLdap() {
    setTabError(null);
    setTabHint(null);
    try {
      const saved = await saveLdapSettings(ldap);
      setLdap({ ...saved, ldap_bind_password: "" });
      setTabHint({ tab: "ldap", message: "LDAP сохранён" });
    } catch (e) {
      setTabError({
        tab: "ldap",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function saveGitlab() {
    setTabError(null);
    setTabHint(null);
    try {
      const saved = await saveGitLabSettings(gitlab);
      setGitlab({ ...EMPTY_GITLAB, ...saved });
      setTabHint({ tab: "gitlab", message: "GitLab CI сохранён" });
    } catch (e) {
      setTabError({
        tab: "gitlab",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function testGitlab() {
    setTestingGitlab(true);
    setTabError(null);
    setTabHint(null);
    try {
      await saveGitLabSettings(gitlab);
      const result = await testGitLabConnection();
      if (result.ok) {
        setTabHint({
          tab: "gitlab",
          message: result.project_path
            ? `${result.message} (${result.project_path})`
            : result.message,
        });
      } else {
        setTabError({ tab: "gitlab", message: result.message });
      }
    } catch (e) {
      setTabError({
        tab: "gitlab",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setTestingGitlab(false);
    }
  }

  if (!open) return null;

  const loading =
    tab === "users" ? loadingUsers : tab === "ldap" ? loadingLdap : loadingGitlab;
  const showError = tabError?.tab === tab ? tabError.message : null;
  const showHint = tabHint?.tab === tab && !showError ? tabHint.message : null;

  return (
    <div className="docs-overlay" onClick={onClose}>
      <div
        className="docs-panel panel settings-panel docs-panel-wide"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="docs-head">
          <h2>Настройки портала</h2>
          <button className="ghost small" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="inline" style={{ marginBottom: 16, gap: 8, flexWrap: "wrap" }}>
          {(
            [
              ["users", "Пользователи"],
              ["ldap", "LDAP / AD"],
              ["gitlab", "GitLab CI"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={`pill-source ${tab === id ? "active" : ""}`}
              type="button"
              onClick={() => switchTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {loading && <div className="hint">Загрузка…</div>}
        {showError && <div className="error">{showError}</div>}
        {showHint && <div className="hint">{showHint}</div>}

        {tab === "users" && !loadingUsers && (
          <>
            <section>
              <h3>Учётные записи</h3>
              <p className="hint">
                У каждого пользователя своя история сборок. Пароль хранится в БД (BCrypt).
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Логин</th>
                      <th>Роль</th>
                      <th>LDAP</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.username}>
                        <td>
                          <code>{u.username}</code>
                        </td>
                        <td>
                          <span className="tag">{u.role}</span>
                        </td>
                        <td className="muted">{u.ldap_only ? "да" : "локальный"}</td>
                        <td>
                          {u.username !== "admin" && (
                            <button
                              className="ghost small"
                              type="button"
                              onClick={() => removeUser(u.username)}
                            >
                              ✕
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h3>Новый пользователь</h3>
              <div className="row">
                <div className="field">
                  <label>Логин</label>
                  <input value={newUser} onChange={(e) => setNewUser(e.target.value)} />
                </div>
                <div className="field">
                  <label>Пароль</label>
                  <input
                    type="password"
                    value={newPass}
                    disabled={newLdapOnly}
                    onChange={(e) => setNewPass(e.target.value)}
                  />
                </div>
                <div className="field" style={{ width: 120, flex: "none" }}>
                  <label>Роль</label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as UserRole)}
                  >
                    <option value="USER">USER</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                </div>
              </div>
              <label className="inline" style={{ textTransform: "none", marginBottom: 12 }}>
                <input
                  type="checkbox"
                  style={{ width: "auto" }}
                  checked={newLdapOnly}
                  onChange={(e) => setNewLdapOnly(e.target.checked)}
                />
                <span className="muted">Только LDAP (без локального пароля)</span>
              </label>
              <button type="button" onClick={addUser}>
                Создать пользователя
              </button>
            </section>
          </>
        )}

        {tab === "ldap" && !loadingLdap && (
          <section>
            <h3>Корпоративный LDAP / Active Directory</h3>
            <p className="hint">
              Вход доменной учётной записью AD (логин = sAMAccountName). Группы AD не
              синхронизируются — роли задаются в портале.
            </p>
            <label className="inline" style={{ textTransform: "none", marginBottom: 14 }}>
              <input
                type="checkbox"
                style={{ width: "auto" }}
                checked={ldap.ldap_enabled}
                onChange={(e) => setLdap({ ...ldap, ldap_enabled: e.target.checked })}
              />
              <span>Включить LDAP-аутентификацию</span>
            </label>
            <div className="field">
              <label>URL сервера LDAP</label>
              <input
                value={ldap.ldap_url}
                onChange={(e) => setLdap({ ...ldap, ldap_url: e.target.value })}
                placeholder="ldap://dc.corp.local:389"
              />
            </div>
            <div className="field">
              <label>Base DN</label>
              <input
                value={ldap.ldap_base_dn}
                onChange={(e) => setLdap({ ...ldap, ldap_base_dn: e.target.value })}
              />
            </div>
            <div className="field">
              <label>User DN pattern ({`{0}`} = логин)</label>
              <input
                value={ldap.ldap_user_dn_pattern}
                onChange={(e) => setLdap({ ...ldap, ldap_user_dn_pattern: e.target.value })}
              />
            </div>
            <div className="row">
              <div className="field">
                <label>User search base</label>
                <input
                  value={ldap.ldap_user_search_base}
                  onChange={(e) => setLdap({ ...ldap, ldap_user_search_base: e.target.value })}
                />
              </div>
              <div className="field">
                <label>User search filter</label>
                <input
                  value={ldap.ldap_user_search_filter}
                  onChange={(e) =>
                    setLdap({ ...ldap, ldap_user_search_filter: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="row">
              <div className="field">
                <label>Bind DN</label>
                <input
                  value={ldap.ldap_bind_dn}
                  onChange={(e) => setLdap({ ...ldap, ldap_bind_dn: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Bind password</label>
                <input
                  type="password"
                  value={ldap.ldap_bind_password}
                  placeholder="оставьте пустым, чтобы не менять"
                  onChange={(e) => setLdap({ ...ldap, ldap_bind_password: e.target.value })}
                />
              </div>
            </div>
            <button type="button" onClick={saveLdap}>
              Сохранить LDAP
            </button>
          </section>
        )}

        {tab === "gitlab" && !loadingGitlab && (
          <section>
            <h3>GitLab CI и Grafana</h3>
            <p className="hint">
              Trigger token и webhook secret хранятся только в Vault. Локально — env{" "}
              <code>GITLAB_TRIGGER_TOKEN</code>, <code>GITLAB_WEBHOOK_SECRET</code>.
              Webhook URL: <code>/api/runs/webhook/gitlab</code> (заголовок X-Gitlab-Token).
            </p>
            <div className="field">
              <label>GitLab base URL</label>
              <input
                value={gitlab.gitlab_base_url}
                onChange={(e) => setGitlab({ ...gitlab, gitlab_base_url: e.target.value })}
                placeholder="https://gitlab.corp.local"
              />
            </div>
            <div className="row">
              <div className="field">
                <label>Project ID или path</label>
                <input
                  value={gitlab.gitlab_project_id}
                  onChange={(e) => setGitlab({ ...gitlab, gitlab_project_id: e.target.value })}
                  placeholder="123 или group/project"
                />
              </div>
              <div className="field">
                <label>Trigger ref (ветка/tag)</label>
                <input
                  value={gitlab.gitlab_trigger_ref}
                  onChange={(e) => setGitlab({ ...gitlab, gitlab_trigger_ref: e.target.value })}
                />
              </div>
            </div>
            <div className="row">
              <div className="field">
                <label>Переменная для JMeter</label>
                <input
                  value={gitlab.gitlab_jmeter_variable}
                  onChange={(e) =>
                    setGitlab({ ...gitlab, gitlab_jmeter_variable: e.target.value })
                  }
                />
              </div>
              <div className="field">
                <label>Переменная для k6</label>
                <input
                  value={gitlab.gitlab_k6_variable}
                  onChange={(e) => setGitlab({ ...gitlab, gitlab_k6_variable: e.target.value })}
                />
              </div>
            </div>
            <div className="row">
              <div className="field">
                <label>Vault path — trigger token</label>
                <input
                  value={gitlab.gitlab_trigger_token_vault_path}
                  onChange={(e) =>
                    setGitlab({ ...gitlab, gitlab_trigger_token_vault_path: e.target.value })
                  }
                />
              </div>
              <div className="field">
                <label>Vault path — webhook secret</label>
                <input
                  value={gitlab.gitlab_webhook_secret_vault_path}
                  onChange={(e) =>
                    setGitlab({ ...gitlab, gitlab_webhook_secret_vault_path: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="field">
              <label>Grafana base URL</label>
              <input
                value={gitlab.grafana_base_url}
                onChange={(e) => setGitlab({ ...gitlab, grafana_base_url: e.target.value })}
                placeholder="https://grafana.corp.local"
              />
            </div>
            <div className="field">
              <label>Шаблон dashboard ({`{run_id}`}, {`{from}`}, {`{to}`})</label>
              <input
                value={gitlab.grafana_dashboard_template}
                onChange={(e) =>
                  setGitlab({ ...gitlab, grafana_dashboard_template: e.target.value })
                }
              />
            </div>
            <div className="inline" style={{ gap: 12 }}>
              <button type="button" onClick={saveGitlab}>
                Сохранить GitLab
              </button>
              <button type="button" className="ghost" onClick={testGitlab} disabled={testingGitlab}>
                {testingGitlab ? "Проверка…" : "Проверить соединение"}
              </button>
            </div>
          </section>
        )}

        <div className="footer-nav" style={{ marginTop: 16 }}>
          <button className="ghost" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
