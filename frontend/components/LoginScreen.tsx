"use client";

import { useState, type FormEvent } from "react";

export function LoginScreen({
  onLogin,
}: {
  onLogin: (u: string, p: string) => Promise<void>;
}) {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onLogin(user.trim(), pass);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка входа");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-glow" aria-hidden />
      <form className="panel login-card" onSubmit={submit}>
        <h2>Вход в НТ · Портал</h2>
        <p className="muted" style={{ marginTop: -8 }}>
          Подготовка сценариев нагрузочного тестирования · JMeter · k6
        </p>
        <div className="field">
          <label>Логин</label>
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="admin"
            autoFocus
          />
        </div>
        <div className="field">
          <label>Пароль</label>
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder="••••••"
          />
        </div>
        {error && <div className="error">{error}</div>}
        <button type="submit" style={{ width: "100%", marginTop: 6 }} disabled={busy}>
          {busy ? "Вход…" : "Войти →"}
        </button>
        <div className="hint" style={{ textAlign: "center", marginTop: 12 }}>
          Первый запуск: <code>admin</code> / <code>admin</code> — потребуется смена пароля
        </div>
      </form>
    </div>
  );
}
