"use client";

import { useState, type FormEvent } from "react";

export function ChangePasswordScreen({
  username,
  onComplete,
  onLogout,
}: {
  username: string;
  onComplete: () => void;
  onLogout: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (next.length < 8) {
      setError("Новый пароль — минимум 8 символов");
      return;
    }
    if (next !== confirm) {
      setError("Пароли не совпадают");
      return;
    }
    setBusy(true);
    try {
      const { changeOwnPassword } = await import("@/lib/api");
      await changeOwnPassword(current, next);
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-glow" aria-hidden />
      <form className="panel login-card" onSubmit={submit}>
        <h2>Смена пароля</h2>
        <p className="muted" style={{ marginTop: -8 }}>
          Пользователь <code>{username}</code> — перед работой в портале задайте новый пароль.
        </p>
        <div className="field">
          <label>Текущий пароль</label>
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoFocus
          />
        </div>
        <div className="field">
          <label>Новый пароль</label>
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder="минимум 8 символов"
          />
        </div>
        <div className="field">
          <label>Повторите новый пароль</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        {error && <div className="error">{error}</div>}
        <button type="submit" style={{ width: "100%", marginTop: 6 }} disabled={busy}>
          {busy ? "Сохранение…" : "Сохранить и продолжить →"}
        </button>
        <button
          type="button"
          className="ghost"
          style={{ width: "100%", marginTop: 8 }}
          onClick={onLogout}
        >
          Выйти
        </button>
      </form>
    </div>
  );
}
