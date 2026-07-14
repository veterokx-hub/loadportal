"use client";

import { useCallback, useEffect, useState } from "react";
import type { BuildHistoryItem } from "@/lib/api";
import { listBuilds, loadBuildScenario } from "@/lib/api";
import type { Scenario } from "@/lib/types";
import { getUsername } from "@/lib/auth";

export function BuildHistory({
  onRestore,
  refreshKey,
}: {
  onRestore: (scenario: Scenario) => void;
  refreshKey?: number;
}) {
  const [items, setItems] = useState<BuildHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listBuilds());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function restore(id: string) {
    setRestoring(id);
    setError(null);
    try {
      const scenario = await loadBuildScenario(id);
      onRestore(scenario);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRestoring(null);
    }
  }

  return (
    <section className="build-history">
      <div className="build-history-head">
        <h3>История сборок</h3>
        <span className="muted" style={{ fontSize: 12 }}>
          пользователь: <code>{getUsername()}</code> · последние 20
        </span>
        <button className="ghost small" type="button" onClick={load} disabled={loading}>
          {loading ? "…" : "Обновить"}
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {items.length === 0 && !loading && (
        <div className="hint">Сборок пока нет — соберите JMeter или k6 ниже.</div>
      )}
      {items.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Когда</th>
                <th>Сценарий</th>
                <th>Движок</th>
                <th>Файл</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td className="muted" style={{ whiteSpace: "nowrap", fontSize: 12 }}>
                    {new Date(it.created_at).toLocaleString("ru-RU")}
                  </td>
                  <td>{it.scenario_name}</td>
                  <td>
                    <span className="tag">{it.engine}</span>
                  </td>
                  <td>
                    <code>{it.filename}</code>
                  </td>
                  <td>
                    <button
                      className="ghost small"
                      type="button"
                      disabled={restoring === it.id}
                      onClick={() => restore(it.id)}
                    >
                      {restoring === it.id ? "…" : "Подтянуть"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
