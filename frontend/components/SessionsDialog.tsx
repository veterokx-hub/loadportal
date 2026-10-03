"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listSessions, logoutAllApi, revokeSession, type AuthSessionInfo } from "@/lib/api";

function sessionTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SessionsDialog({
  open,
  onClose,
  onLoggedOut,
}: {
  open: boolean;
  onClose: () => void;
  onLoggedOut: () => void;
}) {
  const overlayMouseDown = useRef(false);
  const [rows, setRows] = useState<AuthSessionInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await listSessions());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function killOne(row: AuthSessionInfo) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await revokeSession(row.id);
      if (row.current) {
        onLoggedOut();
        return;
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function killAll() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await logoutAllApi();
      onLoggedOut();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (!open) return null;

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
      <div className="docs-panel panel sessions-panel">
        <div className="docs-head">
          <div>
            <h2>Сессии</h2>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
              Живые входы, до 3 часов каждый
            </p>
          </div>
          <button type="button" className="ghost small" onClick={onClose}>
            ✕
          </button>
        </div>

        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Создана</th>
                <th>Истекает</th>
                <th />
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{sessionTime(row.created_at)}</td>
                  <td>{sessionTime(row.expires_at)}</td>
                  <td>{row.current ? <span className="session-current">эта</span> : null}</td>
                  <td>
                    <button
                      type="button"
                      className="ghost small"
                      disabled={busy}
                      onClick={() => void killOne(row)}
                    >
                      Отозвать
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !error && (
                <tr>
                  <td colSpan={4} className="muted">
                    Нет живых сессий
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="footer-nav" style={{ marginTop: 16, gap: 8 }}>
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>
            Закрыть
          </button>
          <button type="button" onClick={() => void killAll()} disabled={busy || rows.length === 0}>
            Выйти везде
          </button>
        </div>
      </div>
    </div>
  );
}
