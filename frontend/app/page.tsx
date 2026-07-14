"use client";

import { useEffect, useState } from "react";
import type { RequestModel, Scenario } from "@/lib/types";
import { Step1Source } from "@/components/Step1Source";
import { Step2Requests } from "@/components/Step2Requests";
import { Step3Correlation } from "@/components/Step3Correlation";
import { Step4Intensity } from "@/components/Step4Intensity";
import { LoginScreen } from "@/components/LoginScreen";
import { ChangePasswordScreen } from "@/components/ChangePasswordScreen";
import { Documentation } from "@/components/Documentation";
import { Settings } from "@/components/Settings";
import { ScenarioPulse } from "@/components/ScenarioPulse";
import { AppModulesNav } from "@/components/AppModulesNav";
import { ModulePlaceholder } from "@/components/ModulePlaceholder";
import { consolidateRequestParams } from "@/lib/request-params";
import { APP_MODULES, getModule, type AppModuleId } from "@/lib/modules";
import { login as apiLogin, logoutApi } from "@/lib/api";
import {
  clearSession,
  clearMustChangePassword,
  getSession,
  getUsername,
  isAdmin,
  isAuthenticated,
  mustChangePassword,
  saveSession,
} from "@/lib/auth";

const STATE_KEY = "ltp-state-v1";
const MODULE_KEY = "ltp-module";

const STEPS = ["Источник", "Запросы", "Корреляция и параметры", "Интенсивность и сборка"];

function normalize(s: Scenario): Scenario {
  const seen = new Set<string>();
  const withIds = s.requests.map((r, i) => {
    let id = r.id || `req_${i + 1}`;
    while (seen.has(id)) id = `${id}_${i + 1}`;
    seen.add(id);
    return id === r.id ? r : { ...r, id };
  });
  s = { ...s, requests: withIds };
  return {
    ...s,
    load: s.load ?? {
      test_mode: "ramp_hold",
      steps: 5,
      step_duration_sec: 60,
      assumed_latency_sec: 1.0,
    },
    datasets: (s.datasets ?? []).map((d) => ({ ...d, random: d.random ?? false })),
    autostop: s.autostop ?? {
      enabled: false,
      error_rate_pct: 50,
      error_rate_sec: 10,
      avg_response_ms: 0,
      avg_response_sec: 0,
    },
    prometheus: s.prometheus ?? {
      exporter_port: 9001,
      run_id: "1",
      samplers_reg_exp: ".*",
      slo_levels: "0.1;1",
    },
    requests: s.requests.map((r) =>
      consolidateRequestParams({
        ...r,
        intensity: r.intensity ?? { target_rps: 10, ramp_up_sec: 30, hold_sec: 60 },
        validation: r.validation ?? {
          check_response_code: true,
          expected_status: 200,
          response_contains: "",
        },
        dataset_id: r.dataset_id ?? null,
        repeat: r.repeat && r.repeat > 0 ? r.repeat : 1,
      })
    ),
  };
}

export default function Home() {
  const [step, setStep] = useState(0);
  const [maxReached, setMaxReached] = useState(0);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [authed, setAuthed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [passwordOk, setPasswordOk] = useState(false);
  const [moduleId, setModuleId] = useState<AppModuleId>("scenario");

  useEffect(() => {
    const t = (localStorage.getItem("ltp-theme") as "dark" | "light") || "dark";
    setTheme(t);
    document.documentElement.setAttribute("data-theme", t);
    setAuthed(isAuthenticated());

    const savedMod = localStorage.getItem(MODULE_KEY) as AppModuleId | null;
    if (savedMod && APP_MODULES.some((m) => m.id === savedMod)) {
      setModuleId(savedMod);
    }

    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (raw) {
        const st = JSON.parse(raw);
        if (st.scenario) setScenario(normalize(st.scenario));
        if (typeof st.step === "number") setStep(st.step);
        if (typeof st.maxReached === "number") setMaxReached(st.maxReached);
      }
    } catch {
      /* игнорируем повреждённое состояние */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STATE_KEY, JSON.stringify({ scenario, step, maxReached }));
  }, [scenario, step, maxReached, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(MODULE_KEY, moduleId);
  }, [moduleId, hydrated]);

  function selectModule(id: AppModuleId) {
    setModuleId(id);
  }

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("ltp-theme", next);
    document.documentElement.setAttribute("data-theme", next);
  }

  async function handleLogin(u: string, p: string) {
    const session = await apiLogin(u, p);
    saveSession(session);
    setPasswordOk(false);
    setAuthed(true);
  }

  async function logout() {
    await logoutApi();
    clearSession();
    setAuthed(false);
    setScenario(null);
    setStep(0);
    setMaxReached(0);
  }

  function goTo(i: number) {
    if (i > 0 && !scenario) return;
    if (i > maxReached) return;
    setStep(i);
  }

  function advance(i: number) {
    setStep(i);
    setMaxReached((m) => Math.max(m, i));
  }

  function updateRequest(id: string, patch: Partial<RequestModel>) {
    setScenario((prev) =>
      prev
        ? {
            ...prev,
            requests: prev.requests.map((r) =>
              r.id === id ? { ...r, ...patch } : r
            ),
          }
        : prev
    );
  }

  if (!hydrated) return null;

  if (!authed) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  if (mustChangePassword() && !passwordOk) {
    const session = getSession();
    return (
      <ChangePasswordScreen
        username={session?.username ?? ""}
        onComplete={() => {
          clearMustChangePassword();
          setPasswordOk(true);
        }}
        onLogout={logout}
      />
    );
  }

  const admin = isAdmin();
  const username = getUsername() || getSession()?.username || "";
  const activeModule = getModule(moduleId);
  const moduleIndex = APP_MODULES.findIndex((m) => m.id === moduleId);

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <span className="mark" aria-label="эмблема" role="img">
            <svg viewBox="0 0 48 48" width="34" height="34" fill="none">
              <circle cx="24" cy="24" r="22" stroke="var(--accent)" strokeWidth="2.6" />
              <g fill="var(--accent)">
                <rect x="12.5" y="28" width="3.2" height="6" rx="0.6" />
                <rect x="17.5" y="25" width="3.2" height="9" rx="0.6" />
                <rect x="22.5" y="22" width="3.2" height="12" rx="0.6" />
                <rect x="27.5" y="19" width="3.2" height="15" rx="0.6" />
              </g>
              <path
                d="M11 31 C 18 30, 25 27, 30 12"
                stroke="var(--accent)"
                strokeWidth="2.8"
                strokeLinecap="round"
              />
              <path d="M30 8 l4.2 6.4 -8 1 Z" fill="var(--accent)" />
            </svg>
          </span>
          <div>
            <h1>НТ · Портал</h1>
            <div className="sub">
              {username ? `${username} · ` : ""}
              {activeModule.nav}
            </div>
          </div>
        </div>
        <div className="inline topbar-actions">
          <button className="btn-toolbar" onClick={() => setDocsOpen(true)} title="Документация">
            <span className="btn-toolbar-icon">?</span>
            <span className="btn-toolbar-label">Документация</span>
          </button>
          {admin && (
            <button
              className="btn-toolbar btn-toolbar-icon-only"
              onClick={() => setSettingsOpen(true)}
              title="Настройки портала"
            >
              <span className="btn-toolbar-icon">⚙</span>
            </button>
          )}
          <button className="btn-toolbar" onClick={toggleTheme} title="Сменить тему">
            <span className="btn-toolbar-icon">{theme === "dark" ? "☀" : "☾"}</span>
            <span className="btn-toolbar-label">{theme === "dark" ? "Светлая" : "Тёмная"}</span>
          </button>
          <button className="btn-toolbar btn-toolbar-muted" onClick={logout} title="Выйти">
            <span className="btn-toolbar-icon">⎋</span>
            <span className="btn-toolbar-label">Выйти</span>
          </button>
        </div>
      </div>

      <AppModulesNav modules={APP_MODULES} active={moduleId} onSelect={selectModule} />

      <Documentation open={docsOpen} onClose={() => setDocsOpen(false)} />
      {admin && <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />}

      {moduleId !== "scenario" && (
        <ModulePlaceholder
          module={activeModule}
          moduleIndex={moduleIndex}
          onBackToScenario={() => selectModule("scenario")}
        />
      )}

      {moduleId === "scenario" && (
        <>
          <div className="steps-wrap">
            <div className="steps-progress" aria-hidden>
              <div
                className="steps-progress-fill"
                style={{ width: `${scenario ? (step / (STEPS.length - 1)) * 100 : 0}%` }}
              />
            </div>
            <div className="steps">
              {STEPS.map((label, i) => {
                const disabled = (i > 0 && !scenario) || i > maxReached;
                return (
                  <button
                    key={label}
                    className={`step-pill ${i === step ? "active" : ""} ${
                      i < step ? "done" : ""
                    }`}
                    disabled={disabled}
                    onClick={() => goTo(i)}
                  >
                    <span className="step-num">{i + 1}</span>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {scenario && (
            <ScenarioPulse scenario={scenario} currentStep={step} onGoToStep={goTo} />
          )}

          {step === 0 && (
            <Step1Source
              onAnalyzed={(s) => {
                setScenario(normalize(s));
                advance(1);
              }}
            />
          )}

          {step === 1 && scenario && (
            <Step2Requests
              scenario={scenario}
              setScenario={setScenario}
              onBack={() => setStep(0)}
              onNext={() => advance(2)}
            />
          )}

          {step === 2 && scenario && (
            <Step3Correlation
              scenario={scenario}
              setScenario={setScenario}
              updateRequest={updateRequest}
              onBack={() => setStep(1)}
              onNext={() => advance(3)}
            />
          )}

          {step === 3 && scenario && (
            <Step4Intensity
              scenario={scenario}
              setScenario={setScenario}
              updateRequest={updateRequest}
              onRestoreScenario={(s) => {
                setScenario(normalize(s));
                setMaxReached(3);
                setStep(3);
              }}
              onBack={() => setStep(2)}
            />
          )}
        </>
      )}
    </div>
  );
}
