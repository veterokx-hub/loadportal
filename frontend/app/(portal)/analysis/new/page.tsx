"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AnalysisModule } from "@/components/analysis/AnalysisModule";

function NewAnalysisInner() {
  const search = useSearchParams();
  return <AnalysisModule view="new" initialRunId={search.get("run")} />;
}

export default function AnalysisNewPage() {
  return (
    <Suspense fallback={<div className="hint">Загрузка…</div>}>
      <NewAnalysisInner />
    </Suspense>
  );
}
