"use client";

import { useId, useState, type FormEvent } from "react";
import { LogoMark } from "@/components/LogoMark";

export function LoginScreen({
  onLogin,
  notice,
}: {
  onLogin: (u: string, p: string) => Promise<void>;
  notice?: string | null;
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
            <LogoMark size={48} />
          </span>
          <div>
            <p className="login-kicker">Load Test Portal</p>
            <h1 className="login-title">НТ · Портал</h1>
          </div>
        </div>

        <p className="login-lead">
          Подготовка сценариев нагрузочного тестирования · JMeter · k6
        </p>

        {notice && (
          <div className="login-notice" role="status">
            {notice}
          </div>
        )}

        <div className="field">
          <label htmlFor={userId}>Логин</label>
          <input
            id={userId}
            name="username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="логин"
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
      </form>
    </div>
  );
}
