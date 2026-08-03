"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { TestRun } from "@/lib/api";
import { listRuns } from "@/lib/api";
import { RUN_STATUS_LABELS } from "@/lib/run-status";

export function RunsList({
  refreshKey,
  onSelect,
}: {
  refreshKey?: number;
  onSelect: (id: string) => void;
}) {
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [engineFilter, setEngineFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRuns(await listRuns());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const filtered = useMemo(() => {
    return runs.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (engineFilter && r.engine !== engineFilter) return false;
      return true;
    });
  }, [runs, statusFilter, engineFilter]);

  function formatDuration(run: TestRun): string {
    if (!run.started_at) return "—";
    const start = new Date(run.started_at).getTime();
    const end = run.ended_at ? new Date(run.ended_at).getTime() : Date.now();
    const sec = Math.max(0, Math.round((end - start) / 1000));
    if (sec < 60) return `${sec} с`;
    return `${Math.floor(sec / 60)} мин ${sec % 60} с`;
  }

  return (
    <section>
      <div className="row" style={{ marginBottom: 4 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Статус</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Все</option>
            {Object.entries(RUN_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Движок</label>
          <select value={engineFilter} onChange={(e) => setEngineFilter(e.target.value)}>
            <option value="">Все</option>
            <option value="jmeter">JMeter</option>
            <option value="k6">k6</option>
          </select>
        </div>
        <div className="field" style={{ flex: "none", alignSelf: "flex-end" }}>
          <button className="ghost small" type="button" onClick={load} disabled={loading}>
            {loading ? "…" : "Обновить"}
          </button>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {filtered.length === 0 && !loading && (
        <div className="hint">Прогонов ещё нет — создайте запуск на вкладке «Новый запуск».</div>
      )}

      {filtered.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Когда</th>
                <th>Jira</th>
                <th>Сценарий</th>
                <th>Движок</th>
                <th>Статус</th>
                <th>Длительность</th>
                <th>Кто</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td className="muted" style={{ whiteSpace: "nowrap", fontSize: 12 }}>
                    {new Date(r.created_at).toLocaleString("ru-RU")}
                  </td>
                  <td>
                    <code>{r.test_id || "—"}</code>
                  </td>
                  <td>{r.scenario_name}</td>
                  <td>
                    <span className="tag">{r.engine}</span>
                  </td>
                  <td>
                    <span className={`tag run-status run-status-${r.status}`}>
                      {RUN_STATUS_LABELS[r.status] ?? r.status}
                    </span>
                  </td>
                  <td className="muted">{formatDuration(r)}</td>
                  <td className="muted">{r.username}</td>
                  <td>
                    <button className="ghost small" type="button" onClick={() => onSelect(r.id)}>
                      Открыть
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
