"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { RunModule } from "@/components/run/RunModule";
import { usePortal } from "@/context/PortalContext";

function NewRunInner() {
  const { scenario } = usePortal();
  const search = useSearchParams();
  const buildId = search.get("build");
  return (
    <RunModule
      scenario={scenario}
      initialBuildId={buildId}
      view="new"
    />
  );
}

export default function RunNewPage() {
  return (
    <Suspense fallback={<div className="hint">Загрузка…</div>}>
      <NewRunInner />
    </Suspense>
  );
}
