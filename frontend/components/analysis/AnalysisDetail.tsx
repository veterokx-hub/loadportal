"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ANALYSIS_STATUS_LABELS,
  deleteAnalysis,
  getAnalysis,
  rerunAnalysis,
  type AnalysisRun,
} from "@/lib/analysis";
import { AnalysisReportView } from "./AnalysisReportView";

/** Пока анализ считается, страница опрашивает статус: считать долго, ждать нечего. */
const POLL_MS = 2500;

export function AnalysisDetail({
  analysisId,
  onOpen,
  onGone,
}: {
  analysisId: string;
  onOpen: (id: string) => void;
  onGone: () => void;
}) {
  const [row, setRow] = useState<AnalysisRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await getAnalysis(analysisId);
      setRow(next);
      setError(null);
      return next.status;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return "failed" as const;
    }
  }, [analysisId]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const status = await load();
      if (!alive || status === "succeeded" || status === "failed") return;
      timer.current = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  async function rerun() {
    setBusy(true);
    try {
      const created = await rerunAnalysis(analysisId);
      onOpen(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await deleteAnalysis(analysisId);
      onGone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (!row) {
    return error ? <div className="error">{error}</div> : <div className="hint">Загрузка…</div>;
  }

  const pending = row.status === "queued" || row.status === "running";

  return (
    <section>
      {error && <div className="error">{error}</div>}

      {pending && (
        <div className="analysis-pending">
          <div className="analysis-pending-bar" aria-hidden>
            <span />
          </div>
          <div>
            <strong>{ANALYSIS_STATUS_LABELS[row.status]}</strong>
            <p className="muted">
              Читаем метрики за окно теста, размечаем фазы и прогоняем детекторы. Длинный тест —
              десятки запросов в источник, поэтому это занимает от секунд до пары минут.
              Страница обновится сама.
            </p>
          </div>
        </div>
      )}

      {row.status === "failed" && (
        <div className="error analysis-failed">
          <strong>Анализ не удался.</strong> {row.error_message || "Причина не записана."}
        </div>
      )}

      {row.status === "succeeded" && row.report && <AnalysisReportView report={row.report} />}

      <div className="footer-nav">
        <button className="ghost" type="button" onClick={remove} disabled={busy}>
          Удалить отчёт
        </button>
        <button type="button" onClick={rerun} disabled={busy || pending}>
          {busy ? "…" : "Пересчитать"}
        </button>
      </div>
    </section>
  );
}
