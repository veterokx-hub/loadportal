"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ANALYSIS_TABS, analysisDetailPath } from "@/lib/routes";
import { NewAnalysisForm } from "./NewAnalysisForm";
import { AnalysisList } from "./AnalysisList";
import { AnalysisDetail } from "./AnalysisDetail";

type AnalysisView = "new" | "list" | "detail";

export function AnalysisModule({
  view,
  analysisId,
  initialRunId,
}: {
  view: AnalysisView;
  analysisId?: string;
  initialRunId?: string | null;
}) {
  const router = useRouter();
  const [refreshKey, setRefreshKey] = useState(0);

  const tabs = [
    ...ANALYSIS_TABS,
    ...(view === "detail" && analysisId
      ? [{ id: "detail" as const, label: "Отчёт", href: analysisDetailPath(analysisId), num: 3 }]
      : []),
  ];

  const progress = view === "new" ? 0 : view === "list" ? 0.5 : 1;
  const title =
    view === "new" ? "1. Что анализируем" : view === "list" ? "2. Отчёты" : "3. Отчёт";

  return (
    <>
      <div className="steps-wrap">
        <div className="steps-progress" aria-hidden>
          <div className="steps-progress-fill" style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="steps">
          {tabs.map((t) => (
            <Link
              key={t.id}
              href={t.href}
              className={`step-pill ${view === t.id ? "active" : ""} ${
                (view === "list" && t.id === "new") || (view === "detail" && t.id !== "detail")
                  ? "done"
                  : ""
              }`}
            >
              <span className="step-num">{t.num}</span>
              {t.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="panel">
        <h2>{title}</h2>

        {view === "new" && (
          <NewAnalysisForm
            initialRunId={initialRunId}
            onCreated={(id) => {
              setRefreshKey((k) => k + 1);
              router.push(analysisDetailPath(id));
            }}
          />
        )}

        {view === "list" && (
          <AnalysisList
            refreshKey={refreshKey}
            onSelect={(id) => router.push(analysisDetailPath(id))}
          />
        )}

        {view === "detail" && analysisId && (
          <AnalysisDetail
            analysisId={analysisId}
            onOpen={(id) => router.replace(analysisDetailPath(id))}
            onGone={() => router.push("/analysis/list")}
          />
        )}
      </div>
    </>
  );
}
