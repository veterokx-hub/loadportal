"use client";

import { ModulePlaceholder } from "@/components/ModulePlaceholder";
import { APP_MODULES, getModule } from "@/lib/modules";

export default function AnalysisPage() {
  const mod = getModule("analysis");
  const index = APP_MODULES.findIndex((m) => m.id === "analysis");
  return <ModulePlaceholder module={mod} moduleIndex={index} />;
}
