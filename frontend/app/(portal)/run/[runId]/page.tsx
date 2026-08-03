"use client";

import { useParams } from "next/navigation";
import { RunModule } from "@/components/run/RunModule";
import { usePortal } from "@/context/PortalContext";

export default function RunDetailPage() {
  const { scenario } = usePortal();
  const params = useParams();
  const runId = String(params.runId ?? "");
  if (!runId) return null;
  return <RunModule scenario={scenario} view="detail" runId={runId} />;
}
