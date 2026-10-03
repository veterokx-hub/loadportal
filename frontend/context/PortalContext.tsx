"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { PrometheusConfig, RequestModel, Scenario } from "@/lib/types";
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
const NOTICE_KEY = "ltp-session-expired";

const SESSION_EXPIRED_NOTICE =
  "Сессия истекла (3 часа). Сборка в историю не сохранялась — черновик сценария остался на этом устройстве. Войдите снова, чтобы продолжить.";

const PASSWORD_CHANGED_NOTICE =
  "Пароль изменён. Войдите снова — остальные сессии сброшены.";

function markSessionExpiredNotice() {
  try {
    localStorage.setItem(NOTICE_KEY, "1");
  } catch {
    /* ignore */
  }
}

function clearSessionExpiredNotice() {
  try {
    localStorage.removeItem(NOTICE_KEY);
  } catch {
    /* ignore */
  }
}

function hasSessionExpiredNotice(): boolean {
  try {
    return localStorage.getItem(NOTICE_KEY) === "1";
  } catch {
    return false;
  }
}

function clearWorkspaceStorage() {
  try {
    localStorage.removeItem(STATE_KEY);
  } catch {
    /* ignore */
  }
}

function fingerprint(s: Scenario): string {
  return JSON.stringify(s);
}

function readWorkspace(): {
  scenario: Scenario | null;
  maxReached: number;
  baselineFp: string | null;
} {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return { scenario: null, maxReached: 0, baselineFp: null };
    const st = JSON.parse(raw);
    const scenario = st.scenario ? normalizeScenario(st.scenario) : null;
    const maxReached =
      typeof st.maxReached === "number"
        ? st.maxReached
        : typeof st.step === "number"
          ? st.step
          : 0;
    const baselineFp = typeof st.baselineFp === "string" ? st.baselineFp : null;
    return { scenario, maxReached, baselineFp };
  } catch {
    return { scenario: null, maxReached: 0, baselineFp: null };
  }
}

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
    prometheus: {
      exporter_port: 9001,
      run_id: "1",
      samplers_reg_exp: ".*",
      slo_levels: "0.1;1",
      influxdb_url: "http://victoriametrics:8428/write?db=jmeter",
      application: "",
      measurement: "jmeter",
      percentiles: "99;95;90",
      summary_only: false,
      influxdb_token: "",
      ...(s.prometheus as Partial<PrometheusConfig> | undefined),
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
  /** Подтянуть сборку из истории — текущее состояние становится эталоном «без изменений». */
  replaceScenario: (s: Scenario | null) => void;
  /** Текущий сценарий отличается от последней сохранённой / подтянутой сборки. */
  isDirty: boolean;
  markScenarioSaved: () => void;
  maxReached: number;
  setMaxReached: (n: number | ((m: number) => number)) => void;
  advanceMax: (stepIndex: number) => void;
  updateRequest: (id: string, patch: Partial<RequestModel>) => void;
  handleLogin: (u: string, p: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Сброс локальной сессии без запроса — сервер уже отозвал токены. */
  finishLocalLogout: (notice?: string | null) => void;
  afterPasswordChanged: () => void;
  username: string;
  admin: boolean;
  sessionNotice: string | null;
}

const PortalContext = createContext<PortalContextValue | null>(null);

export function PortalProvider({ children }: { children: ReactNode }) {
  const [scenario, setScenarioState] = useState<Scenario | null>(null);
  const [baselineFp, setBaselineFp] = useState<string | null>(null);
  const [maxReached, setMaxReached] = useState(0);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [authed, setAuthed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [passwordOk, setPasswordOk] = useState(false);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const draftRef = useRef({
    scenario: null as Scenario | null,
    maxReached: 0,
    baselineFp: null as string | null,
  });
  draftRef.current = { scenario, maxReached, baselineFp };

  const resetWorkspace = useCallback(() => {
    setScenarioState(null);
    setBaselineFp(null);
    setMaxReached(0);
    setDocsOpen(false);
    setSettingsOpen(false);
    setPasswordOk(false);
    setSessionNotice(null);
    clearWorkspaceStorage();
    clearSessionExpiredNotice();
  }, []);

  useEffect(() => {
    const t = (localStorage.getItem("ltp-theme") as "dark" | "light") || "dark";
    setTheme(t);
    document.documentElement.setAttribute("data-theme", t);

    (async () => {
      const draft = readWorkspace();
      if (draft.scenario) setScenarioState(draft.scenario);
      if (draft.maxReached) setMaxReached(draft.maxReached);
      if (draft.baselineFp) setBaselineFp(draft.baselineFp);

      if (!isAuthenticated()) {
        if (hasSessionExpiredNotice()) setSessionNotice(SESSION_EXPIRED_NOTICE);
        setAuthed(false);
        setHydrated(true);
        return;
      }
      const ok = await validateSession();
      if (!ok) {
        if (!isAuthenticated() && hasSessionExpiredNotice()) {
          setSessionNotice(SESSION_EXPIRED_NOTICE);
        }
        setAuthed(false);
        setHydrated(true);
        return;
      }
      setAuthed(true);
      setHydrated(true);
    })();
  }, []);

  useEffect(() => {
    function onExpired() {
      try {
        localStorage.setItem(STATE_KEY, JSON.stringify(draftRef.current));
      } catch {
        /* ignore */
      }
      markSessionExpiredNotice();
      setAuthed(false);
      setPasswordOk(false);
      setDocsOpen(false);
      setSettingsOpen(false);
      setSessionNotice(SESSION_EXPIRED_NOTICE);
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  useEffect(() => {
    if (!hydrated || !authed) return;
    localStorage.setItem(STATE_KEY, JSON.stringify({ scenario, maxReached, baselineFp }));
  }, [scenario, maxReached, baselineFp, hydrated, authed]);

  const setScenario = useCallback((s: Scenario | null) => {
    setScenarioState(s ? normalizeScenario(s) : null);
  }, []);

  const replaceScenario = useCallback((s: Scenario | null) => {
    const next = s ? normalizeScenario(s) : null;
    setScenarioState(next);
    setBaselineFp(next ? fingerprint(next) : null);
  }, []);

  const markScenarioSaved = useCallback(() => {
    setBaselineFp(scenario ? fingerprint(scenario) : null);
  }, [scenario]);

  const isDirty = useMemo(() => {
    if (!scenario || scenario.requests.length === 0) return false;
    if (baselineFp == null) return true;
    return fingerprint(scenario) !== baselineFp;
  }, [scenario, baselineFp]);

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
    setSessionNotice(null);
    clearSessionExpiredNotice();
    setAuthed(true);
  }, []);

  const finishLocalLogout = useCallback((notice?: string | null) => {
    clearSession();
    setAuthed(false);
    resetWorkspace();
    if (notice) setSessionNotice(notice);
  }, [resetWorkspace]);

  const logout = useCallback(async () => {
    await logoutApi();
    finishLocalLogout();
  }, [finishLocalLogout]);

  const afterPasswordChanged = useCallback(() => {
    clearSession();
    setAuthed(false);
    setPasswordOk(false);
    setDocsOpen(false);
    setSettingsOpen(false);
    setSessionNotice(PASSWORD_CHANGED_NOTICE);
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
      replaceScenario,
      isDirty,
      markScenarioSaved,
      maxReached,
      setMaxReached,
      advanceMax,
      updateRequest,
      handleLogin,
      logout,
      finishLocalLogout,
      afterPasswordChanged,
      username: getUsername() || getSession()?.username || "",
      admin: isAdmin(),
      sessionNotice,
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
      replaceScenario,
      isDirty,
      markScenarioSaved,
      maxReached,
      advanceMax,
      updateRequest,
      handleLogin,
      logout,
      finishLocalLogout,
      afterPasswordChanged,
      sessionNotice,
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
