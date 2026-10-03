"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ANALYSIS_STATUS_LABELS,
  VERDICT_META,
  listAnalyses,
  type AnalysisRun,
} from "@/lib/analysis";
import { analysisDetailPath, analysisNewPath } from "@/lib/routes";

/**
 * Мостик из карточки прогона в анализ.
 *
 * После завершения теста отчёт заводится автоматически, и человек должен увидеть
 * его там, где смотрит на прогон, — иначе автозапуск никто не найдёт.
 */
export function RunAnalysisLink({ runId, targetFilled }: { runId: string; targetFilled: boolean }) {
  const [rows, setRows] = useState<AnalysisRun[] | null>(null);

  useEffect(() => {
    let alive = true;
    listAnalyses(runId)
      .then((list) => alive && setRows(list))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, [runId]);

  if (rows === null) return null;

  const latest = rows[0];
  if (!latest) {
    return (
      <div className="run-analysis">
        <span className="muted">
          {targetFilled
            ? "Отчёта по этому прогону пока нет."
            : "Отчёта нет: у прогона не заполнены cluster / namespace / service."}
        </span>
        <Link href={analysisNewPath(runId)} className="pill-source">
          Проанализировать
        </Link>
      </div>
    );
  }

  const meta = latest.verdict ? VERDICT_META[latest.verdict] : null;
  const tone = latest.status === "failed" ? "err" : meta?.tone ?? "muted";

  return (
    <div className={`run-analysis tone-${tone}`}>
      {latest.status === "succeeded" ? (
        <>
          <strong className="run-analysis-score">{latest.health_score}</strong>
          <span className="run-analysis-text">{latest.headline || meta?.pitch}</span>
        </>
      ) : (
        <span className="run-analysis-text">
          Анализ: {ANALYSIS_STATUS_LABELS[latest.status]}
          {latest.status === "failed" && latest.error_message ? ` — ${latest.error_message}` : ""}
        </span>
      )}
      <Link href={analysisDetailPath(latest.id)} className="pill-source">
        Открыть отчёт
      </Link>
      {rows.length > 1 && <span className="muted">всего отчётов: {rows.length}</span>}
    </div>
  );
}
