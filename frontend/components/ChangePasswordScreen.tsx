"use client";

import { useId, useState, type FormEvent } from "react";

export function ChangePasswordScreen({
  username,
  onComplete,
  onLogout,
}: {
  username: string;
  onComplete: () => void;
  onLogout: () => void;
}) {
  const uid = useId();
  const currentId = `${uid}-current`;
  const nextId = `${uid}-next`;
  const confirmId = `${uid}-confirm`;
  const errId = `${uid}-err`;

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
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
      <div className="login-atmosphere" aria-hidden>
        <span className="login-orb login-orb-a" />
        <span className="login-orb login-orb-b" />
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
              <path
                d="M16 24h16M24 16v16"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <div>
            <p className="login-kicker">Безопасность</p>
            <h1 className="login-title">Смена пароля</h1>
          </div>
        </div>

        <p className="login-lead">
          Пользователь <code>{username}</code> — задайте новый пароль перед работой в портале.
        </p>

        <div className="field">
          <label htmlFor={currentId}>Текущий пароль</label>
          <input
            id={currentId}
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoFocus
            disabled={busy}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errId : undefined}
          />
        </div>
        <div className="field">
          <label htmlFor={nextId}>Новый пароль</label>
          <input
            id={nextId}
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder="минимум 8 символов"
            disabled={busy}
            aria-invalid={Boolean(error)}
          />
        </div>
        <div className="field">
          <label htmlFor={confirmId}>Повторите новый пароль</label>
          <input
            id={confirmId}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
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
          disabled={busy}
        >
          {busy && <span className="btn-spinner" aria-hidden />}
          <span className="btn-label">{busy ? "Сохранение…" : "Сохранить и продолжить"}</span>
        </button>
        <button
          type="button"
          className="ghost btn-block"
          style={{ marginTop: 8 }}
          onClick={onLogout}
          disabled={busy}
        >
          Выйти
        </button>
      </form>
    </div>
  );
}
