"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ANALYSIS_STATUS_LABELS,
  VERDICT_META,
  formatWindow,
  listAnalyses,
  type AnalysisRun,
} from "@/lib/analysis";

export function AnalysisList({
  refreshKey,
  onSelect,
}: {
  refreshKey?: number;
  onSelect: (id: string) => void;
}) {
  const [rows, setRows] = useState<AnalysisRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listAnalyses());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  return (
    <section>
      <div className="row analysis-list-head">
        <span className="hint" style={{ flex: 1 }}>
          Отчёты хранятся целиком: правила меняются, но старый отчёт остаётся тем, каким его
          прочитали. Версия правил показана в карточке.
        </span>
        <button className="ghost small" type="button" onClick={load} disabled={loading}>
          {loading ? "…" : "Обновить"}
        </button>
      </div>

      {error && <div className="error">{error}</div>}
      {rows.length === 0 && !loading && (
        <div className="hint">Отчётов пока нет — соберите первый на вкладке «Что анализируем».</div>
      )}

      {rows.length > 0 && (
        <div className="analysis-cards">
          {rows.map((row) => {
            const meta = row.verdict ? VERDICT_META[row.verdict] : null;
            const tone = row.status === "failed" ? "err" : meta?.tone ?? "muted";
            return (
              <button
                type="button"
                key={row.id}
                className={`analysis-card tone-${tone}`}
                onClick={() => onSelect(row.id)}
              >
                <span className="analysis-card-score">
                  {row.status === "succeeded" ? (
                    <>
                      <strong>{row.health_score}</strong>
                      <span>из 100</span>
                    </>
                  ) : (
                    <span className={`analysis-card-status st-${row.status}`}>
                      {ANALYSIS_STATUS_LABELS[row.status]}
                    </span>
                  )}
                </span>
                <span className="analysis-card-body">
                  <span className="analysis-card-title">
                    {row.status === "failed"
                      ? row.error_message || "Анализ не удался"
                      : row.headline || meta?.pitch || "Отчёт считается…"}
                  </span>
                  <span className="analysis-card-meta muted">
                    <code>{row.target.service || "—"}</code>
                    {row.target.namespace && ` · ${row.target.namespace}`}
                    {" · "}
                    {formatWindow(row.window_from, row.window_to)}
                    {row.demo && " · демо"}
                  </span>
                </span>
                <span className="analysis-card-side muted">
                  {row.status === "succeeded" && (
                    <span className="tag">
                      находок: {row.findings_count}
                    </span>
                  )}
                  <span>{new Date(row.created_at).toLocaleString("ru-RU")}</span>
                  <span>{row.username}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
