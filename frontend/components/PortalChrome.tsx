"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { LoginScreen } from "@/components/LoginScreen";
import { ChangePasswordScreen } from "@/components/ChangePasswordScreen";
import { Documentation } from "@/components/Documentation";
import { SessionsDialog } from "@/components/SessionsDialog";
import { Settings } from "@/components/Settings";
import { AppModulesNav } from "@/components/AppModulesNav";
import { LogoMark } from "@/components/LogoMark";
import { APP_MODULES, getModule } from "@/lib/modules";
import { moduleIdFromPath } from "@/lib/routes";
import { getSession, mustChangePassword, usePortal } from "@/context/PortalContext";

export function PortalChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const {
    hydrated,
    authed,
    passwordOk,
    theme,
    toggleTheme,
    docsOpen,
    setDocsOpen,
    settingsOpen,
    setSettingsOpen,
    sessionNotice,
    handleLogin,
    logout,
    finishLocalLogout,
    afterPasswordChanged,
    username,
    admin,
  } = usePortal();
  const [sessionsOpen, setSessionsOpen] = useState(false);

  if (!hydrated) {
    return (
      <div className="boot-splash" role="status" aria-live="polite" aria-busy="true">
        <span className="boot-splash-mark" aria-hidden>
          <LogoMark size={40} />
        </span>
        <span className="boot-splash-text">Загрузка портала…</span>
      </div>
    );
  }

  if (!authed) {
    return <LoginScreen onLogin={handleLogin} notice={sessionNotice} />;
  }

  if (mustChangePassword() && !passwordOk) {
    const session = getSession();
    return (
      <ChangePasswordScreen
        username={session?.username ?? ""}
        onComplete={afterPasswordChanged}
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
            <LogoMark size={48} />
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
            className="btn-toolbar"
            onClick={() => setSessionsOpen(true)}
            title="Сессии"
            aria-label="Список сессий"
          >
            <span className="btn-toolbar-icon" aria-hidden>
              ⌘
            </span>
            <span className="btn-toolbar-label">Сессии</span>
          </button>
          <button
            type="button"
            className="btn-toolbar btn-toolbar-muted"
            onClick={logout}
            title="Выйти на всех устройствах"
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
      <SessionsDialog
        open={sessionsOpen}
        onClose={() => setSessionsOpen(false)}
        onLoggedOut={() => {
          setSessionsOpen(false);
          finishLocalLogout();
        }}
      />
      {admin && (
        <Settings
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          onForceLogout={(notice) => {
            setSettingsOpen(false);
            finishLocalLogout(notice);
          }}
        />
      )}

      {children}
    </div>
  );
}
