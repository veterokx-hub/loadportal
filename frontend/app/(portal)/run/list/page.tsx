"use client";

import { RunModule } from "@/components/run/RunModule";
import { usePortal } from "@/context/PortalContext";

export default function RunListPage() {
  const { scenario } = usePortal();
  return <RunModule scenario={scenario} view="list" />;
}
