"use client";

import { useCallback, useEffect, useState } from "react";
import type { BuildHistoryItem } from "@/lib/api";
import { listBuilds, loadBuildScenario } from "@/lib/api";
import type { Scenario } from "@/lib/types";
import { getUsername } from "@/lib/auth";
import { SaveScenarioDialog } from "@/components/SaveScenarioDialog";

export function BuildHistory({
  onRestore,
  refreshKey,
  currentScenario,
  defaultEngine = "jmeter",
}: {
  onRestore: (scenario: Scenario) => void;
  refreshKey?: number;
  /** Текущий сценарий — если в нём есть запросы, перед подтягиванием предложим сохранить сборку. */
  currentScenario?: Scenario | null;
  defaultEngine?: "jmeter" | "k6";
}) {
  const [items, setItems] = useState<BuildHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null);

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

  async function doRestore(id: string) {
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

  function restore(id: string) {
    // Текущая работа будет заменена — предложим сохранить сборку.
    if (currentScenario && currentScenario.requests.length > 0) {
      setPendingRestoreId(id);
      return;
    }
    doRestore(id);
  }

  return (
    <section className="build-history">
      {pendingRestoreId && currentScenario && (
        <SaveScenarioDialog
          scenario={currentScenario}
          title="Подтянуть старую сборку"
          message={`Текущий сценарий «${currentScenario.name}» будет заменён выбранной сборкой. Сохранить текущую сборку перед этим?`}
          defaultEngine={defaultEngine}
          onCancel={() => setPendingRestoreId(null)}
          onDone={(saved) => {
            const id = pendingRestoreId;
            setPendingRestoreId(null);
            if (saved) load();
            if (id) doRestore(id);
          }}
        />
      )}
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
        <div className="hint">Сборок пока нет — сохраните сборку на шаге «Интенсивность и сборка».</div>
      )}
      {items.length > 0 && (
        <div className="table-wrap build-history-scroll">
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
