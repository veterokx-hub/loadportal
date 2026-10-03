"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { usePortal } from "@/context/PortalContext";
import {
  SCENARIO_STEPS,
  scenarioPath,
  scenarioSlugByIndex,
  type ScenarioStepSlug,
} from "@/lib/routes";
import { ScenarioPulse } from "@/components/ScenarioPulse";
import { SaveScenarioDialog } from "@/components/SaveScenarioDialog";
import { Step1Source } from "@/components/Step1Source";
import { Step2Requests } from "@/components/Step2Requests";
import { Step3Correlation } from "@/components/Step3Correlation";
import { Step4Intensity } from "@/components/Step4Intensity";
import { runNewPath } from "@/lib/routes";

export function ScenarioWorkspace({ stepSlug }: { stepSlug: ScenarioStepSlug }) {
  const router = useRouter();
  const {
    scenario,
    setScenario,
    replaceScenario,
    isDirty,
    markScenarioSaved,
    maxReached,
    setMaxReached,
    advanceMax,
    updateRequest,
  } = usePortal();
  const [newScenarioDialog, setNewScenarioDialog] = useState(false);

  const step = SCENARIO_STEPS.find((s) => s.slug === stepSlug)?.index ?? 0;

  function goTo(i: number) {
    if (i > 0 && !scenario) return;
    if (i > maxReached) return;
    router.push(scenarioPath(scenarioSlugByIndex(i)));
  }

  function advance(i: number) {
    advanceMax(i);
    router.push(scenarioPath(scenarioSlugByIndex(i)));
  }

  function resetToNewScenario() {
    setNewScenarioDialog(false);
    replaceScenario(null);
    setMaxReached(0);
    router.push(scenarioPath("source"));
  }

  function onNewScenarioClick() {
    if (scenario && scenario.requests.length > 0 && isDirty) {
      setNewScenarioDialog(true);
    } else {
      resetToNewScenario();
    }
  }

  return (
    <>
      {newScenarioDialog && scenario && (
        <SaveScenarioDialog
          scenario={scenario}
          title="Новый сценарий"
          message={`Текущий сценарий «${scenario.name}» будет очищен. Сохранить текущую сборку перед началом нового сценария?`}
          onCancel={() => setNewScenarioDialog(false)}
          onDone={(saved) => {
            if (saved) markScenarioSaved();
            resetToNewScenario();
          }}
        />
      )}

      <div className="scenario-toolbar">
        <button type="button" className="ghost small" onClick={onNewScenarioClick}>
          + Новый сценарий
        </button>
      </div>

      <div className="steps-wrap">
        <div className="steps-progress" aria-hidden>
          <div
            className="steps-progress-fill"
            style={{ width: `${scenario ? (step / (SCENARIO_STEPS.length - 1)) * 100 : 0}%` }}
          />
        </div>
        <div className="steps">
          {SCENARIO_STEPS.map((s) => {
            const disabled = (s.index > 0 && !scenario) || s.index > maxReached;
            const active = s.index === step;
            const done = s.index < step;
            if (disabled) {
              return (
                <button key={s.slug} type="button" className="step-pill" disabled>
                  <span className="step-num">{s.index + 1}</span>
                  {s.label}
                </button>
              );
            }
            return (
              <Link
                key={s.slug}
                href={scenarioPath(s.slug)}
                className={`step-pill ${active ? "active" : ""} ${done ? "done" : ""}`}
              >
                <span className="step-num">{s.index + 1}</span>
                {s.label}
              </Link>
            );
          })}
        </div>
      </div>

      {scenario && (
        <ScenarioPulse scenario={scenario} currentStep={step} onGoToStep={goTo} />
      )}

      {step === 0 && (
        <Step1Source
          currentScenario={scenario}
          onAnalyzed={(s) => {
            setScenario(s);
            advance(1);
          }}
          onRestore={(s) => {
            replaceScenario(s);
            advanceMax(3);
            router.push(scenarioPath("intensity"));
          }}
        />
      )}

      {step === 1 && scenario && (
        <Step2Requests
          scenario={scenario}
          setScenario={setScenario}
          onBack={() => router.push(scenarioPath("source"))}
          onNext={() => advance(2)}
        />
      )}

      {step === 2 && scenario && (
        <Step3Correlation
          scenario={scenario}
          setScenario={setScenario}
          updateRequest={updateRequest}
          onBack={() => router.push(scenarioPath("requests"))}
          onNext={() => advance(3)}
        />
      )}

      {step === 3 && scenario && (
        <Step4Intensity
          scenario={scenario}
          setScenario={setScenario}
          updateRequest={updateRequest}
          onRestoreScenario={(s) => {
            replaceScenario(s);
            advanceMax(3);
            router.push(scenarioPath("intensity"));
          }}
          onBack={() => router.push(scenarioPath("correlation"))}
          onGoToRun={(buildId) => {
            router.push(runNewPath(buildId));
          }}
        />
      )}
    </>
  );
}
