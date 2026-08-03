"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ScenarioWorkspace } from "@/components/ScenarioWorkspace";
import { usePortal } from "@/context/PortalContext";
import {
  SCENARIO_STEPS,
  scenarioPath,
  scenarioSlugByIndex,
  type ScenarioStepSlug,
} from "@/lib/routes";

const VALID = new Set(SCENARIO_STEPS.map((s) => s.slug));

export default function ScenarioStepPage() {
  const params = useParams();
  const router = useRouter();
  const { scenario, maxReached, hydrated } = usePortal();
  const step = String(params.step ?? "source");

  useEffect(() => {
    if (!hydrated) return;
    if (!VALID.has(step as ScenarioStepSlug)) {
      router.replace(scenarioPath("source"));
      return;
    }
    const index = SCENARIO_STEPS.find((s) => s.slug === step)?.index ?? 0;
    if (index > 0 && !scenario) {
      router.replace(scenarioPath("source"));
      return;
    }
    if (index > maxReached) {
      router.replace(scenarioPath(scenarioSlugByIndex(maxReached)));
    }
  }, [hydrated, step, scenario, maxReached, router]);

  if (!VALID.has(step as ScenarioStepSlug)) return null;

  return <ScenarioWorkspace stepSlug={step as ScenarioStepSlug} />;
}
