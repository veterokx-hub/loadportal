"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PortalUser, AuditEvent } from "@/lib/api";
import {
  createUser,
  deleteUser,
  setUserPassword,
  setUserRole,
  listUsers,
  listAuditEvents,
} from "@/lib/api";
import { getUsername, type UserRole } from "@/lib/auth";

type SettingsTab = "users" | "audit";

const AUDIT_LABELS: Record<string, string> = {
  LOGIN: "Вход",
  BUILD_SAVE: "Сохранение сборки",
  SCRIPT_EXPORT: "Выгрузка скрипта",
  RUN_START: "Запуск теста",
};

function auditLabel(action: string): string {
  return AUDIT_LABELS[action] ?? action;
}

function auditTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function auditDetail(action: string, detail: string): string {
  if (action === "LOGIN") {
    if (detail === "ldap") return "LDAP";
    if (detail === "local") return "локальный вход";
  }
  return detail;
}

export function Settings({
  open,
  onClose,
  onForceLogout,
}: {
  open: boolean;
  onClose: () => void;
  onForceLogout?: (notice: string) => void;
}) {
  const overlayMouseDown = useRef(false);
  const [tab, setTab] = useState<SettingsTab>("users");
  const [users, setUsers] = useState<PortalUser[]>([]);
  const [tabError, setTabError] = useState<{ tab: SettingsTab; message: string } | null>(null);
  const [tabHint, setTabHint] = useState<{ tab: SettingsTab; message: string } | null>(null);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [auditLoaded, setAuditLoaded] = useState(false);
  const [userNameQ, setUserNameQ] = useState("");
  const [userRoleQ, setUserRoleQ] = useState<UserRole | "">("");
  const [auditActionQ, setAuditActionQ] = useState("");

  const [newUser, setNewUser] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("USER");
  const [newLdapOnly, setNewLdapOnly] = useState(false);
  const [resetUser, setResetUser] = useState("");
  const [resetPass, setResetPass] = useState("");

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
    } catch (e) {
      setTabError({
        tab: "users",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setTabError(null);
    setTabHint(null);
    setTab("users");
    setAuditLoaded(false);
    setUserNameQ("");
    setUserRoleQ("");
    setAuditActionQ("");
    loadUsers();
  }, [open, loadUsers]);

  const loadAudit = useCallback(async () => {
    setLoadingAudit(true);
    setTabError(null);
    try {
      setAudit(await listAuditEvents());
      setAuditLoaded(true);
    } catch (e) {
      setTabError({
        tab: "audit",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoadingAudit(false);
    }
  }, []);

  useEffect(() => {
    if (!open || tab !== "audit" || auditLoaded) return;
    loadAudit();
  }, [open, tab, auditLoaded, loadAudit]);

  async function changeRole(username: string, role: UserRole) {
    setTabError(null);
    setTabHint(null);
    try {
      const updated = await setUserRole(username, role);
      setUsers((prev) => prev.map((u) => (u.username === updated.username ? updated : u)));
    } catch (e) {
      setTabError({
        tab: "users",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

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

  async function resetPassword() {
    const name = resetUser.trim();
    setTabError(null);
    setTabHint(null);
    try {
      await setUserPassword(name, resetPass);
      setResetPass("");
      const self = name.toLowerCase() === (getUsername() || "").toLowerCase();
      const msg = `Пароль ${name} сброшен — сессии отозваны, при входе нужна смена пароля`;
      if (self && onForceLogout) {
        onForceLogout(msg);
        return;
      }
      setTabHint({ tab: "users", message: msg });
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

  if (!open) return null;

  const loading = tab === "users" ? loadingUsers : loadingAudit;
  const showError = tabError?.tab === tab ? tabError.message : null;
  const showHint = tabHint?.tab === tab && !showError ? tabHint.message : null;
  const filteredUsers = users
    .filter((u) => {
      if (userRoleQ && u.role !== userRoleQ) return false;
      const q = userNameQ.trim().toLowerCase();
      if (q && !u.username.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => a.username.localeCompare(b.username, "ru"));
  const shownUsers = filteredUsers.slice(0, 5);
  const shownAudit = audit.filter((e) => !auditActionQ || e.action === auditActionQ);

  return (
    <div
      className="docs-overlay"
      onMouseDown={(e) => {
        overlayMouseDown.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (overlayMouseDown.current && e.target === e.currentTarget) onClose();
      }}
    >
      <div className="docs-panel panel settings-panel docs-panel-wide">
        <div className="docs-head">
          <h2>Настройки портала</h2>
          <button className="ghost small" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="settings-body">
        <div className="inline" style={{ marginBottom: 16, gap: 8, flexWrap: "wrap" }}>
          {(
            [
              ["users", "Пользователи"],
              ["audit", "Журнал"],
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
                LDAP-пользователи создаются при первом входе. Роль можно сменить здесь.
              </p>
              <div className="user-filters">
                <div className="field">
                  <label>Имя</label>
                  <input
                    value={userNameQ}
                    placeholder="фильтр по логину"
                    onChange={(e) => setUserNameQ(e.target.value)}
                  />
                </div>
                <div className="field" style={{ width: 160, flex: "none" }}>
                  <label>Роль</label>
                  <select
                    value={userRoleQ}
                    onChange={(e) => setUserRoleQ((e.target.value || "") as UserRole | "")}
                  >
                    <option value="">все</option>
                    <option value="USER">USER</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                </div>
              </div>
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
                    {shownUsers.map((u) => (
                      <tr key={u.username}>
                        <td>
                          <code>{u.username}</code>
                        </td>
                        <td>
                          <select
                            className="role-select"
                            value={u.role}
                            disabled={u.username.toLowerCase() === "admin"}
                            title={
                              u.username.toLowerCase() === "admin"
                                ? "Роль встроенного admin нельзя снять"
                                : undefined
                            }
                            onChange={(e) => changeRole(u.username, e.target.value as UserRole)}
                          >
                            <option value="USER">USER</option>
                            <option value="ADMIN">ADMIN</option>
                          </select>
                        </td>
                        <td className="muted">{u.ldap_only ? "да" : "локальный"}</td>
                        <td>
                          {u.username.toLowerCase() !== "admin" && (
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
                    {shownUsers.length === 0 && (
                      <tr>
                        <td colSpan={4} className="muted">
                          Нет пользователей по фильтру
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {filteredUsers.length > 5 && (
                <p className="hint">
                  Показаны 5 из {filteredUsers.length}. Уточните фильтр по имени или роли.
                </p>
              )}
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

            <section>
              <h3>Сброс пароля</h3>
              <p className="hint">
                Пользователь сменит пароль при следующем входе. Все его сессии отзываются сразу.
              </p>
              <div className="row">
                <div className="field">
                  <label>Логин</label>
                  <select
                    value={resetUser}
                    onChange={(e) => setResetUser(e.target.value)}
                  >
                    <option value="">выберите</option>
                    {users
                      .filter((u) => !u.ldap_only)
                      .map((u) => (
                        <option key={u.username} value={u.username}>
                          {u.username}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="field">
                  <label>Новый пароль</label>
                  <input
                    type="password"
                    value={resetPass}
                    onChange={(e) => setResetPass(e.target.value)}
                    placeholder="минимум 8 символов"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => void resetPassword()}
                disabled={!resetUser || resetPass.length < 8}
              >
                Сбросить пароль
              </button>
            </section>
          </>
        )}

        {tab === "audit" && (
          <section>
            <div className="audit-toolbar">
              <div>
                <h3>Журнал действий</h3>
                <p className="hint">
                  Входы, сохранения сборок, выгрузка скриптов и запуски тестов. Новые сверху,
                  хранятся последние 500 событий.
                </p>
              </div>
              <button
                type="button"
                className="ghost small"
                onClick={() => void loadAudit()}
              >
                Обновить
              </button>
            </div>
            <div className="user-filters">
              <div className="field" style={{ width: 240, flex: "none" }}>
                <label>Событие</label>
                <select value={auditActionQ} onChange={(e) => setAuditActionQ(e.target.value)}>
                  <option value="">все</option>
                  {Object.entries(AUDIT_LABELS).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="table-wrap">
              <table className="audit-table">
                <thead>
                  <tr>
                    <th>Время</th>
                    <th>Пользователь</th>
                    <th>Событие</th>
                    <th>Детали</th>
                  </tr>
                </thead>
                <tbody>
                  {shownAudit.map((e) => (
                    <tr key={e.id}>
                      <td className="audit-time">{auditTime(e.created_at)}</td>
                      <td>
                        <code>{e.username}</code>
                      </td>
                      <td>
                        <span className={`audit-chip audit-${e.action.toLowerCase()}`}>
                          {auditLabel(e.action)}
                        </span>
                      </td>
                      <td className="muted">{auditDetail(e.action, e.detail)}</td>
                    </tr>
                  ))}
                  {shownAudit.length === 0 && (
                    <tr>
                      <td colSpan={4} className="muted">
                        Пока нет записей
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
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
    </div>
  );
}
