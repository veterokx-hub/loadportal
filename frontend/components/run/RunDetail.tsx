"use client";

import { useCallback, useEffect, useState } from "react";
import { cancelRun, getRun } from "@/lib/api";
import { RUN_STATUS_LABELS, VERDICT_LABELS } from "@/lib/run-status";
import { safeHttpHref } from "@/lib/safe-url";
import { RunAnalysisLink } from "@/components/analysis/RunAnalysisLink";

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
  const [canceling, setCanceling] = useState(false);

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

  async function cancel() {
    if (!window.confirm("Остановить прогон? Pipeline в GitLab будет отменён.")) return;
    setCanceling(true);
    setError(null);
    try {
      setRun(await cancelRun(runId));
      onRefreshList();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCanceling(false);
    }
  }

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

  const paramStr = (key: string) => {
    const v = run.params?.[key];
    return typeof v === "string" && v ? v : null;
  };
  const gitlabHref = safeHttpHref(run.gitlab_web_url);
  const grafanaHref = safeHttpHref(run.grafana_url);

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
        {(run.status === "queued" || run.status === "running") && (
          <button className="ghost small" type="button" onClick={cancel} disabled={canceling}>
            {canceling ? "Останавливаем…" : "Остановить"}
          </button>
        )}
      </div>

      {error && <div className="error">{error}</div>}
      {run.error_message && <div className="error">{run.error_message}</div>}
      {run.verdict && (
        <div className="row">
          <div className="field">
            <label>Вердикт</label>
            <span
              className={`tag run-status run-status-${run.verdict.status === "passed" ? "succeeded" : "failed"}`}
            >
              {VERDICT_LABELS[run.verdict.status] ?? run.verdict.status}
            </span>
          </div>
          <div className="field">
            <label>p95</label>
            <code>{run.verdict.p95_ms == null ? "—" : `${Math.round(run.verdict.p95_ms)} мс`}</code>
          </div>
          <div className="field">
            <label>p99</label>
            <code>{run.verdict.p99_ms == null ? "—" : `${Math.round(run.verdict.p99_ms)} мс`}</code>
          </div>
          <div className="field">
            <label>Ошибки</label>
            <code>
              {run.verdict.error_rate_pct == null ? "—" : `${run.verdict.error_rate_pct.toFixed(2)}%`}
            </code>
          </div>
          <div className="field">
            <label>RPS</label>
            <code>{run.verdict.rps == null ? "—" : run.verdict.rps.toFixed(1)}</code>
          </div>
        </div>
      )}

      <RunAnalysisLink runId={run.id} targetFilled={Boolean(run.target_service)} />

      <div className="inline" style={{ gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {gitlabHref && (
          <a href={gitlabHref} target="_blank" rel="noreferrer" className="pill-source">
            Pipeline в GitLab
          </a>
        )}
        {grafanaHref && (
          <a href={grafanaHref} target="_blank" rel="noreferrer" className="pill-source">
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

      <div className="row">
        {paramStr("scenario_path") && (
          <div className="field">
            <label>SCENARIO_PATH</label>
            <code style={{ fontSize: 12 }}>{paramStr("scenario_path")}</code>
          </div>
        )}
        {paramStr("repository") && (
          <div className="field">
            <label>REPOSITORY</label>
            <code>{paramStr("repository")}</code>
          </div>
        )}
      </div>
      <div className="row">
        {paramStr("cpu") && (
          <div className="field">
            <label>CPU</label>
            <code>{paramStr("cpu")}</code>
          </div>
        )}
        {paramStr("memory") && (
          <div className="field">
            <label>Memory</label>
            <code>{paramStr("memory")}</code>
          </div>
        )}
        {paramStr("start_time") && (
          <div className="field">
            <label>START_TIME</label>
            <code style={{ fontSize: 12 }}>{paramStr("start_time")}</code>
          </div>
        )}
        {paramStr("end_time") && (
          <div className="field">
            <label>END_TIME</label>
            <code style={{ fontSize: 12 }}>{paramStr("end_time")}</code>
          </div>
        )}
      </div>

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
