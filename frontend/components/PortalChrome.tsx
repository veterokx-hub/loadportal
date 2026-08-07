"use client";

import { usePathname } from "next/navigation";
import { LoginScreen } from "@/components/LoginScreen";
import { ChangePasswordScreen } from "@/components/ChangePasswordScreen";
import { Documentation } from "@/components/Documentation";
import { Settings } from "@/components/Settings";
import { AppModulesNav } from "@/components/AppModulesNav";
import { APP_MODULES, getModule } from "@/lib/modules";
import { moduleIdFromPath } from "@/lib/routes";
import {
  clearMustChangePassword,
  getSession,
  mustChangePassword,
  usePortal,
} from "@/context/PortalContext";

export function PortalChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const {
    hydrated,
    authed,
    passwordOk,
    setPasswordOk,
    theme,
    toggleTheme,
    docsOpen,
    setDocsOpen,
    settingsOpen,
    setSettingsOpen,
    handleLogin,
    logout,
    username,
    admin,
  } = usePortal();

  if (!hydrated) {
    return (
      <div className="boot-splash" role="status" aria-live="polite" aria-busy="true">
        <span className="boot-splash-mark" aria-hidden />
        <span className="boot-splash-text">Загрузка портала…</span>
      </div>
    );
  }

  if (!authed) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  if (mustChangePassword() && !passwordOk) {
    const session = getSession();
    return (
      <ChangePasswordScreen
        username={session?.username ?? ""}
        onComplete={() => {
          clearMustChangePassword();
          setPasswordOk(true);
        }}
        onLogout={logout}
      />
    );
  }

  const moduleId = moduleIdFromPath(pathname);
  const activeModule = getModule(moduleId);

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <span className="mark" aria-label="эмблема" role="img">
            <svg viewBox="0 0 48 48" width="34" height="34" fill="none">
              <circle cx="24" cy="24" r="22" stroke="var(--accent)" strokeWidth="2.6" />
              <g fill="var(--accent)">
                <rect x="12.5" y="28" width="3.2" height="6" rx="0.6" />
                <rect x="17.5" y="25" width="3.2" height="9" rx="0.6" />
                <rect x="22.5" y="22" width="3.2" height="12" rx="0.6" />
                <rect x="27.5" y="19" width="3.2" height="15" rx="0.6" />
              </g>
              <path
                d="M11 31 C 18 30, 25 27, 30 12"
                stroke="var(--accent)"
                strokeWidth="2.8"
                strokeLinecap="round"
              />
              <path d="M30 8 l4.2 6.4 -8 1 Z" fill="var(--accent)" />
            </svg>
          </span>
          <div>
            <h1>НТ · Портал</h1>
            <div className="sub">
              {username ? `${username} · ` : ""}
              {activeModule.nav}
            </div>
          </div>
        </div>
        <div className="inline topbar-actions">
          <button
            type="button"
            className="btn-toolbar"
            onClick={() => setDocsOpen(true)}
            title="Документация"
            aria-label="Открыть документацию"
          >
            <span className="btn-toolbar-icon" aria-hidden>
              ?
            </span>
            <span className="btn-toolbar-label">Документация</span>
          </button>
          {admin && (
            <button
              type="button"
              className="btn-toolbar btn-toolbar-icon-only"
              onClick={() => setSettingsOpen(true)}
              title="Настройки портала"
              aria-label="Настройки портала"
            >
              <span className="btn-toolbar-icon" aria-hidden>
                ⚙
              </span>
            </button>
          )}
          <button
            type="button"
            className="btn-toolbar"
            onClick={toggleTheme}
            title="Сменить тему"
            aria-label={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}
          >
            <span className="btn-toolbar-icon" aria-hidden>
              {theme === "dark" ? "☀" : "☾"}
            </span>
            <span className="btn-toolbar-label">{theme === "dark" ? "Светлая" : "Тёмная"}</span>
          </button>
          <button
            type="button"
            className="btn-toolbar btn-toolbar-muted"
            onClick={logout}
            title="Выйти"
            aria-label="Выйти из портала"
          >
            <span className="btn-toolbar-icon" aria-hidden>
              ⎋
            </span>
            <span className="btn-toolbar-label">Выйти</span>
          </button>
        </div>
      </div>

      <AppModulesNav modules={APP_MODULES} active={moduleId} />

      {/* Оверлеи без смены URL */}
      <Documentation open={docsOpen} onClose={() => setDocsOpen(false)} />
      {admin && <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />}

      {children}
    </div>
  );
}
