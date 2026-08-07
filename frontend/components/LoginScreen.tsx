"use client";

import { useId, useState, type FormEvent } from "react";

export function LoginScreen({
  onLogin,
}: {
  onLogin: (u: string, p: string) => Promise<void>;
}) {
  const uid = useId();
  const userId = `${uid}-user`;
  const passId = `${uid}-pass`;
  const errId = `${uid}-err`;

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onLogin(username.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка входа");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-atmosphere" aria-hidden>
        <span className="login-orb login-orb-a" />
        <span className="login-orb login-orb-b" />
        <span className="login-orb login-orb-c" />
        <span className="login-grid" />
      </div>

      <form
        className="panel login-card"
        onSubmit={submit}
        aria-busy={busy}
        noValidate
      >
        <div className="login-brand">
          <span className="login-mark" aria-hidden>
            <svg viewBox="0 0 48 48" width="28" height="28" fill="none">
              <circle cx="24" cy="24" r="22" stroke="currentColor" strokeWidth="2.4" />
              <g fill="currentColor">
                <rect x="12.5" y="28" width="3.2" height="6" rx="0.6" />
                <rect x="17.5" y="25" width="3.2" height="9" rx="0.6" />
                <rect x="22.5" y="22" width="3.2" height="12" rx="0.6" />
                <rect x="27.5" y="19" width="3.2" height="15" rx="0.6" />
              </g>
              <path
                d="M11 31 C 18 30, 25 27, 30 12"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <div>
            <p className="login-kicker">Load Test Portal</p>
            <h1 className="login-title">НТ · Портал</h1>
          </div>
        </div>

        <p className="login-lead">
          Подготовка сценариев нагрузочного тестирования · JMeter · k6
        </p>

        <div className="field">
          <label htmlFor={userId}>Логин</label>
          <input
            id={userId}
            name="username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="admin"
            autoFocus
            disabled={busy}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errId : undefined}
          />
        </div>
        <div className="field">
          <label htmlFor={passId}>Пароль</label>
          <input
            id={passId}
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            disabled={busy}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errId : undefined}
          />
        </div>

        {error && (
          <div id={errId} className="error login-error" role="alert">
            {error}
          </div>
        )}

        <button
          type="submit"
          className={`btn-block ${busy ? "is-loading" : ""}`}
          disabled={busy || !username.trim() || !password}
        >
          {busy && <span className="btn-spinner" aria-hidden />}
          <span className="btn-label">{busy ? "Входим…" : "Войти"}</span>
        </button>

        <p className="hint login-hint">
          Первый запуск: <code>admin</code> / <code>admin</code> — затем смена пароля
        </p>
      </form>
    </div>
  );
}
