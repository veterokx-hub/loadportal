"use client";

import { ModulePlaceholder } from "@/components/ModulePlaceholder";
import { getModule } from "@/lib/modules";
import { APP_MODULES } from "@/lib/modules";

export default function EnvironmentPage() {
  const mod = getModule("environment");
  const index = APP_MODULES.findIndex((m) => m.id === "environment");
  return <ModulePlaceholder module={mod} moduleIndex={index} />;
}
