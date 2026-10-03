"use client";

import { useParams } from "next/navigation";
import { AnalysisModule } from "@/components/analysis/AnalysisModule";

export default function AnalysisDetailPage() {
  const params = useParams();
  const analysisId = String(params.analysisId ?? "");
  if (!analysisId) return null;
  return <AnalysisModule view="detail" analysisId={analysisId} />;
}
