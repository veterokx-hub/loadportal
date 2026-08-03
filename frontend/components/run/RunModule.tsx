"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Scenario } from "@/lib/types";
import { NewRunForm } from "./NewRunForm";
import { RunsList } from "./RunsList";
import { RunDetail } from "./RunDetail";
import { RUN_TABS, runDetailPath } from "@/lib/routes";
import Link from "next/link";

type RunView = "new" | "list" | "detail";

export function RunModule({
  scenario,
  initialBuildId,
  view,
  runId,
}: {
  scenario: Scenario | null;
  initialBuildId?: string | null;
  view: RunView;
  runId?: string;
}) {
  const router = useRouter();
  const [refreshKey, setRefreshKey] = useState(0);

  const tabs = [
    ...RUN_TABS,
    ...(view === "detail" && runId
      ? [{ id: "detail" as const, label: "Карточка", href: runDetailPath(runId), num: 3 }]
      : []),
  ];

  const progress =
    view === "new" ? 0 : view === "list" ? 0.5 : 1;

  const title =
    view === "new"
      ? "1. Новый запуск"
      : view === "list"
        ? "2. Прогоны"
        : "3. Карточка прогона";

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
                (view === "list" && t.id === "new") ||
                (view === "detail" && t.id !== "detail")
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
          <NewRunForm
            scenario={scenario}
            initialBuildId={initialBuildId}
            onCreated={(id) => {
              setRefreshKey((k) => k + 1);
              router.push(runDetailPath(id));
            }}
          />
        )}

        {view === "list" && (
          <RunsList
            refreshKey={refreshKey}
            onSelect={(id) => router.push(runDetailPath(id))}
          />
        )}

        {view === "detail" && runId && (
          <RunDetail
            runId={runId}
            onRefreshList={() => setRefreshKey((k) => k + 1)}
          />
        )}
      </div>
    </>
  );
}
