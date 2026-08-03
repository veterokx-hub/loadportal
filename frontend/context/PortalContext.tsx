"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { RequestModel, Scenario } from "@/lib/types";
import { consolidateRequestParams } from "@/lib/request-params";
import { AUTH_EXPIRED_EVENT, login as apiLogin, logoutApi, validateSession } from "@/lib/api";
import {
  clearMustChangePassword,
  clearSession,
  getSession,
  getUsername,
  isAdmin,
  isAuthenticated,
  mustChangePassword,
  saveSession,
} from "@/lib/auth";

const STATE_KEY = "ltp-state-v1";

function normalizeScenario(s: Scenario): Scenario {
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

interface PortalContextValue {
  hydrated: boolean;
  authed: boolean;
  passwordOk: boolean;
  setPasswordOk: (v: boolean) => void;
  theme: "dark" | "light";
  toggleTheme: () => void;
  docsOpen: boolean;
  setDocsOpen: (v: boolean) => void;
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
  scenario: Scenario | null;
  setScenario: (s: Scenario | null) => void;
  maxReached: number;
  setMaxReached: (n: number | ((m: number) => number)) => void;
  advanceMax: (stepIndex: number) => void;
  updateRequest: (id: string, patch: Partial<RequestModel>) => void;
  handleLogin: (u: string, p: string) => Promise<void>;
  logout: () => Promise<void>;
  username: string;
  admin: boolean;
}

const PortalContext = createContext<PortalContextValue | null>(null);

export function PortalProvider({ children }: { children: ReactNode }) {
  const [scenario, setScenarioState] = useState<Scenario | null>(null);
  const [maxReached, setMaxReached] = useState(0);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [authed, setAuthed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [passwordOk, setPasswordOk] = useState(false);

  useEffect(() => {
    const t = (localStorage.getItem("ltp-theme") as "dark" | "light") || "dark";
    setTheme(t);
    document.documentElement.setAttribute("data-theme", t);

    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (raw) {
        const st = JSON.parse(raw);
        if (st.scenario) setScenarioState(normalizeScenario(st.scenario));
        if (typeof st.maxReached === "number") setMaxReached(st.maxReached);
        // миграция со старого step → maxReached
        if (typeof st.step === "number" && typeof st.maxReached !== "number") {
          setMaxReached(st.step);
        }
      }
    } catch {
      /* ignore */
    }

    (async () => {
      if (!isAuthenticated()) {
        setAuthed(false);
        setHydrated(true);
        return;
      }
      const ok = await validateSession();
      setAuthed(ok);
      setHydrated(true);
    })();
  }, []);

  useEffect(() => {
    function onExpired() {
      setAuthed(false);
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STATE_KEY, JSON.stringify({ scenario, maxReached }));
  }, [scenario, maxReached, hydrated]);

  const setScenario = useCallback((s: Scenario | null) => {
    setScenarioState(s ? normalizeScenario(s) : null);
  }, []);

  const advanceMax = useCallback((stepIndex: number) => {
    setMaxReached((m) => Math.max(m, stepIndex));
  }, []);

  const updateRequest = useCallback((id: string, patch: Partial<RequestModel>) => {
    setScenarioState((prev) =>
      prev
        ? {
            ...prev,
            requests: prev.requests.map((r) => (r.id === id ? { ...r, ...patch } : r)),
          }
        : prev
    );
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem("ltp-theme", next);
      document.documentElement.setAttribute("data-theme", next);
      return next;
    });
  }, []);

  const handleLogin = useCallback(async (u: string, p: string) => {
    const session = await apiLogin(u, p);
    saveSession(session);
    setPasswordOk(false);
    setAuthed(true);
  }, []);

  const logout = useCallback(async () => {
    await logoutApi();
    clearSession();
    setAuthed(false);
    setScenarioState(null);
    setMaxReached(0);
  }, []);

  const value = useMemo<PortalContextValue>(
    () => ({
      hydrated,
      authed,
      passwordOk,
      setPasswordOk,
      theme,
      toggleTheme,
      docsOpen,
      setDocsOpen,
      settingsOpen,
      setSettingsOpen,
      scenario,
      setScenario,
      maxReached,
      setMaxReached,
      advanceMax,
      updateRequest,
      handleLogin,
      logout,
      username: getUsername() || getSession()?.username || "",
      admin: isAdmin(),
    }),
    [
      hydrated,
      authed,
      passwordOk,
      theme,
      toggleTheme,
      docsOpen,
      settingsOpen,
      scenario,
      setScenario,
      maxReached,
      advanceMax,
      updateRequest,
      handleLogin,
      logout,
    ]
  );

  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>;
}

export function usePortal(): PortalContextValue {
  const ctx = useContext(PortalContext);
  if (!ctx) throw new Error("usePortal must be used within PortalProvider");
  return ctx;
}

export { clearMustChangePassword, getSession, mustChangePassword };
