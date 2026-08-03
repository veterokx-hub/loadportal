"use client";

import { useCallback, useEffect, useState } from "react";
import { getRun } from "@/lib/api";
import { RUN_STATUS_LABELS } from "@/lib/run-status";

export function RunDetail({
  runId,
  onRefreshList,
}: {
  runId: string;
  onRefreshList: () => void;
}) {
  const [run, setRun] = useState<Awaited<ReturnType<typeof getRun>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRun(await getRun(runId));
      onRefreshList();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [runId, onRefreshList]);

  useEffect(() => {
    load();
  }, [load]);

  async function copyId() {
    await navigator.clipboard.writeText(runId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading && !run) {
    return <div className="hint">Загрузка…</div>;
  }

  if (error && !run) {
    return <div className="error">{error}</div>;
  }

  if (!run) return null;

  const heap =
    run.params && typeof run.params.heap_mb === "number" ? run.params.heap_mb : null;

  return (
    <section>
      <div className="build-history-head" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>{run.scenario_name}</h3>
        <span className={`tag run-status run-status-${run.status}`}>
          {RUN_STATUS_LABELS[run.status] ?? run.status}
        </span>
        <button className="ghost small" type="button" onClick={load} disabled={loading}>
          {loading ? "…" : "Обновить"}
        </button>
      </div>

      {run.error_message && <div className="error">{run.error_message}</div>}

      <div className="inline" style={{ gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {run.gitlab_web_url && (
          <a href={run.gitlab_web_url} target="_blank" rel="noreferrer" className="pill-source">
            Pipeline в GitLab
          </a>
        )}
        {run.grafana_url && (
          <a href={run.grafana_url} target="_blank" rel="noreferrer" className="pill-source">
            Grafana
          </a>
        )}
        <button type="button" className="ghost small" onClick={copyId}>
          {copied ? "Скопировано" : "Копировать run_id"}
        </button>
      </div>

      <div className="row">
        <div className="field">
          <label>Jira</label>
          <code>{run.test_id || "—"}</code>
        </div>
        <div className="field">
          <label>Движок</label>
          <span className="tag">{run.engine}</span>
        </div>
        <div className="field">
          <label>Кто запустил</label>
          <span>{run.username}</span>
        </div>
      </div>

      <div className="field">
        <label>Target URL</label>
        <code style={{ wordBreak: "break-all", fontSize: 13 }}>{run.target_url || "—"}</code>
      </div>

      <div className="row">
        <div className="field">
          <label>run_id</label>
          <code style={{ fontSize: 12 }}>{run.id}</code>
        </div>
        {run.build_id && (
          <div className="field">
            <label>build_id</label>
            <code style={{ fontSize: 12 }}>{run.build_id}</code>
          </div>
        )}
        {run.script_id && (
          <div className="field">
            <label>script_id</label>
            <code style={{ fontSize: 12 }}>{run.script_id}</code>
          </div>
        )}
      </div>

      {heap != null && (
        <div className="field" style={{ maxWidth: 200 }}>
          <label>Память JVM</label>
          <div>{heap} МБ</div>
        </div>
      )}

      <h3 style={{ fontSize: 13, marginTop: 8 }}>История</h3>
      {run.events.length === 0 ? (
        <div className="hint">Событий пока нет</div>
      ) : (
        <ul className="run-timeline">
          {run.events.map((ev, i) => (
            <li key={`${ev.at}-${i}`}>
              <span className="muted" style={{ fontSize: 12 }}>
                {new Date(ev.at).toLocaleString("ru-RU")}
              </span>
              <strong>{ev.event}</strong>
              <span>{ev.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
