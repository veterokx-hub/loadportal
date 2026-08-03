"use client";

import { ModulePlaceholder } from "@/components/ModulePlaceholder";
import { APP_MODULES, getModule } from "@/lib/modules";

export default function ReportPage() {
  const mod = getModule("report");
  const index = APP_MODULES.findIndex((m) => m.id === "report");
  return <ModulePlaceholder module={mod} moduleIndex={index} />;
}
