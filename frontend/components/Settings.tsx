"use client";

import { useEffect, useState } from "react";
import type { InfrastructureSettings, LdapSettings, PortalUser } from "@/lib/api";
import {
  createUser,
  deleteUser,
  getInfrastructureSettings,
  getLdapSettings,
  listUsers,
  saveInfrastructureSettings,
  saveLdapSettings,
} from "@/lib/api";
import type { UserRole } from "@/lib/auth";

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

const EMPTY_INFRA: InfrastructureSettings = {
  consul_enabled: false,
  consul_host: "localhost",
  consul_port: 8500,
  consul_datacenter: "",
  consul_kv_prefix: "loadtest/",
  consul_service_analyzer: "loadtest-analyzer",
  consul_service_k6: "loadtest-k6-generator",
  consul_service_jmeter: "loadtest-jmeter-builder",
  analyzer_url: "",
  k6_generator_url: "",
  jmeter_builder_url: "",
  resolved_analyzer_url: "http://localhost:8000",
  resolved_k6_generator_url: "http://localhost:8001",
  resolved_jmeter_builder_url: "http://localhost:8081",
  consul_reachable: false,
};

export function Settings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<"users" | "ldap" | "infra">("users");
  const [users, setUsers] = useState<PortalUser[]>([]);
  const [ldap, setLdap] = useState<LdapSettings>(EMPTY_LDAP);
  const [infra, setInfra] = useState<InfrastructureSettings>(EMPTY_INFRA);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [savedHint, setSavedHint] = useState<string | null>(null);

  const [newUser, setNewUser] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("USER");
  const [newLdapOnly, setNewLdapOnly] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSavedHint(null);
    setLoading(true);
    Promise.all([listUsers(), getLdapSettings(), getInfrastructureSettings()])
      .then(([u, l, i]) => {
        setUsers(u);
        setLdap({ ...EMPTY_LDAP, ...l, ldap_bind_password: "" });
        setInfra({ ...EMPTY_INFRA, ...i });
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [open]);

  async function addUser() {
    setError(null);
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function removeUser(username: string) {
    setError(null);
    try {
      await deleteUser(username);
      setUsers(await listUsers());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function saveLdap() {
    setError(null);
    setSavedHint(null);
    try {
      const saved = await saveLdapSettings(ldap);
      setLdap({ ...saved, ldap_bind_password: "" });
      setSavedHint("LDAP сохранён");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function saveInfra() {
    setError(null);
    setSavedHint(null);
    try {
      const saved = await saveInfrastructureSettings(infra);
      setInfra(saved);
      setSavedHint(
        saved.consul_enabled
          ? saved.consul_reachable
            ? "Инфраструктура сохранена · Consul доступен"
            : "Инфраструктура сохранена · Consul недоступен (проверьте host/port)"
          : "Инфраструктура сохранена · используются localhost / env"
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!open) return null;

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
              ["infra", "Инфраструктура"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={`pill-source ${tab === id ? "active" : ""}`}
              type="button"
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {loading && <div className="hint">Загрузка…</div>}
        {error && <div className="error">{error}</div>}
        {savedHint && !error && <div className="hint">{savedHint}</div>}

        {tab === "users" && !loading && (
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

        {tab === "ldap" && !loading && (
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

        {tab === "infra" && !loading && (
          <section>
            <h3>Инфраструктура и discovery</h3>
            <p className="hint">
              По умолчанию модули ходят друг к другу по <code>localhost</code> (или env в
              Docker/k8s). Включите Consul, чтобы URL брались из KV{" "}
              <code>{`{prefix}services/{{service}}/url`}</code> или из Catalog. Явный URL в
              полях ниже имеет высший приоритет.
            </p>

            <label className="inline" style={{ textTransform: "none", marginBottom: 14 }}>
              <input
                type="checkbox"
                style={{ width: "auto" }}
                checked={infra.consul_enabled}
                onChange={(e) => setInfra({ ...infra, consul_enabled: e.target.checked })}
              />
              <span>Использовать Consul</span>
            </label>

            <div className="row">
              <div className="field">
                <label>Consul host</label>
                <input
                  value={infra.consul_host}
                  onChange={(e) => setInfra({ ...infra, consul_host: e.target.value })}
                  placeholder="localhost"
                />
              </div>
              <div className="field" style={{ width: 120, flex: "none" }}>
                <label>Port</label>
                <input
                  type="number"
                  value={infra.consul_port}
                  onChange={(e) =>
                    setInfra({ ...infra, consul_port: Number(e.target.value) || 8500 })
                  }
                />
              </div>
              <div className="field">
                <label>Datacenter (опц.)</label>
                <input
                  value={infra.consul_datacenter}
                  onChange={(e) => setInfra({ ...infra, consul_datacenter: e.target.value })}
                />
              </div>
            </div>
            <div className="field">
              <label>KV prefix</label>
              <input
                value={infra.consul_kv_prefix}
                onChange={(e) => setInfra({ ...infra, consul_kv_prefix: e.target.value })}
                placeholder="loadtest/"
              />
            </div>
            <div className="row">
              <div className="field">
                <label>Service name · analyzer</label>
                <input
                  value={infra.consul_service_analyzer}
                  onChange={(e) =>
                    setInfra({ ...infra, consul_service_analyzer: e.target.value })
                  }
                />
              </div>
              <div className="field">
                <label>Service name · k6-generator</label>
                <input
                  value={infra.consul_service_k6}
                  onChange={(e) => setInfra({ ...infra, consul_service_k6: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Service name · jmeter-builder</label>
                <input
                  value={infra.consul_service_jmeter}
                  onChange={(e) =>
                    setInfra({ ...infra, consul_service_jmeter: e.target.value })
                  }
                />
              </div>
            </div>

            <h3 style={{ marginTop: 18 }}>Прямые URL модулей (override)</h3>
            <p className="hint">Пусто = auto (Consul или localhost/env).</p>
            <div className="field">
              <label>analyzer URL</label>
              <input
                value={infra.analyzer_url}
                onChange={(e) => setInfra({ ...infra, analyzer_url: e.target.value })}
                placeholder="http://localhost:8000"
              />
            </div>
            <div className="field">
              <label>k6-generator URL</label>
              <input
                value={infra.k6_generator_url}
                onChange={(e) => setInfra({ ...infra, k6_generator_url: e.target.value })}
                placeholder="http://localhost:8001"
              />
            </div>
            <div className="field">
              <label>jmeter-builder URL</label>
              <input
                value={infra.jmeter_builder_url}
                onChange={(e) => setInfra({ ...infra, jmeter_builder_url: e.target.value })}
                placeholder="http://localhost:8081"
              />
            </div>

            <h3 style={{ marginTop: 18 }}>Резолв сейчас</h3>
            <div className="hint" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
              <div>
                analyzer → <code>{infra.resolved_analyzer_url}</code>
              </div>
              <div>
                k6-generator → <code>{infra.resolved_k6_generator_url}</code>
              </div>
              <div>
                jmeter-builder → <code>{infra.resolved_jmeter_builder_url}</code>
              </div>
              <div>
                Consul:{" "}
                {infra.consul_enabled
                  ? infra.consul_reachable
                    ? "reachable"
                    : "unreachable"
                  : "выкл."}
              </div>
            </div>

            <button type="button" style={{ marginTop: 14 }} onClick={saveInfra}>
              Сохранить инфраструктуру
            </button>
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
