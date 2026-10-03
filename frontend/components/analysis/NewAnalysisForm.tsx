"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEMO_FAULTS,
  TEST_KIND_META,
  createAnalysis,
  parseDashboardLink,
  type AnalysisTarget,
  type TestKind,
} from "@/lib/analysis";
import { listRuns, type TestRun } from "@/lib/api";

type SourceMode = "run" | "link" | "manual";

const WINDOW_PRESETS = [
  { id: "30m", label: "30 минут", minutes: 30 },
  { id: "2h", label: "2 часа", minutes: 120 },
  { id: "8h", label: "8 часов", minutes: 480 },
  { id: "24h", label: "24 часа", minutes: 1440 },
];

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isoFrom(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

const EMPTY_TARGET: AnalysisTarget = { cluster: "", namespace: "", service: "", container: "" };

export function NewAnalysisForm({
  initialRunId,
  onCreated,
}: {
  initialRunId?: string | null;
  onCreated: (id: string) => void;
}) {
  const [mode, setMode] = useState<SourceMode>(initialRunId ? "run" : "manual");
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [runId, setRunId] = useState(initialRunId ?? "");
  const [link, setLink] = useState("");
  const [linkNote, setLinkNote] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [target, setTarget] = useState<AnalysisTarget>(EMPTY_TARGET);
  const [testKind, setTestKind] = useState<TestKind>("ramp_hold");
  const [fromLocal, setFromLocal] = useState("");
  const [toLocal, setToLocal] = useState("");
  const [sloP99, setSloP99] = useState("");
  const [sloErrors, setSloErrors] = useState("");
  const [demo, setDemo] = useState(false);
  const [demoFault, setDemoFault] = useState<string>("leak");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    try {
      const list = await listRuns();
      setRuns(list);
      if (!runId && initialRunId && list.some((r) => r.id === initialRunId)) {
        setRunId(initialRunId);
      }
    } catch {
      /* прогонов может не быть — форма работает и без них */
    }
  }, [initialRunId, runId]);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  const selectedRun = useMemo(() => runs.find((r) => r.id === runId) ?? null, [runs, runId]);

  // Прогон знает и цель, и окно — форма подставляет их, но не запирает.
  useEffect(() => {
    if (mode !== "run" || !selectedRun) return;
    setTarget({
      cluster: selectedRun.target_cluster ?? "",
      namespace: selectedRun.target_namespace ?? "",
      service: selectedRun.target_service ?? "",
      container: selectedRun.target_container ?? "",
    });
    if (selectedRun.started_at) setFromLocal(toLocalInput(new Date(selectedRun.started_at)));
    if (selectedRun.ended_at) setToLocal(toLocalInput(new Date(selectedRun.ended_at)));
  }, [mode, selectedRun]);

  async function applyLink() {
    if (!link.trim()) return;
    setParsing(true);
    setError(null);
    setLinkNote(null);
    try {
      const hint = await parseDashboardLink(link.trim());
      setTarget({
        cluster: hint.target.cluster || "",
        namespace: hint.target.namespace || "",
        service: hint.target.service || "",
        container: hint.target.container || "",
      });
      if (hint.window_from) setFromLocal(toLocalInput(new Date(hint.window_from)));
      if (hint.window_to) setToLocal(toLocalInput(new Date(hint.window_to)));
      const found = hint.matched.length;
      setLinkNote(
        found === 0
          ? "Из ссылки ничего не вытащить — в ней нет переменных дашборда. Заполните поля ниже."
          : `Из ссылки взято: ${hint.matched.join(", ")}${
              hint.unmatched.length > 0 ? `. Осталось ввести: ${hint.unmatched.join(", ")}` : ""
            }`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setParsing(false);
    }
  }

  function applyPreset(minutes: number) {
    const to = new Date();
    setToLocal(toLocalInput(to));
    setFromLocal(toLocalInput(new Date(to.getTime() - minutes * 60_000)));
  }

  const canSubmit = demo || Boolean(target.service.trim() && target.namespace.trim()) || Boolean(runId);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const created = await createAnalysis({
        run_id: mode === "run" ? runId || undefined : undefined,
        target: { ...target },
        grafana_url: mode === "link" ? link.trim() || undefined : undefined,
        window_from: isoFrom(fromLocal),
        window_to: isoFrom(toLocal),
        profile: {
          test_kind: testKind,
          slo_p99_ms: sloP99 ? Number(sloP99) : undefined,
          slo_error_rate_pct: sloErrors ? Number(sloErrors) : undefined,
        },
        demo,
        demo_fault: demo ? demoFault : undefined,
      });
      onCreated(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="analysis-form">
      <p className="hint report-lead">
        Модуль сам читает метрики сервиса за время теста, размечает фазы нагрузки и ищет
        отклонения — не «где график вырос», а где поведение разошлось с нормой этого же
        прогона. На выходе — гипотеза, куда смотреть в коде.
      </p>

      <h3>Откуда взять цель и окно</h3>
      <div className="inline analysis-modes">
        {(
          [
            { id: "run" as const, label: "Из прогона портала", hint: "Цель и время берутся из карточки прогона" },
            { id: "link" as const, label: "Из ссылки на дашборд", hint: "Вставьте URL Grafana — переменные разберутся сами" },
            { id: "manual" as const, label: "Ввести руками", hint: "Кластер, namespace, сервис и период" },
          ]
        ).map((m) => (
          <button
            type="button"
            key={m.id}
            className={`pill-source ${mode === m.id ? "active" : ""}`}
            onClick={() => setMode(m.id)}
            title={m.hint}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === "run" && (
        <div className="field">
          <label>Прогон</label>
          <select value={runId} onChange={(e) => setRunId(e.target.value)}>
            <option value="">— выберите прогон —</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {new Date(r.created_at).toLocaleString("ru-RU")} · {r.test_id || r.scenario_name} · {r.engine}
              </option>
            ))}
          </select>
          {runs.length === 0 && (
            <div className="hint">
              Прогонов пока нет. Запустите тест в модуле «Запуск» или введите цель руками.
            </div>
          )}
          {selectedRun && !selectedRun.target_service && (
            <div className="hint">
              У этого прогона не заполнена цель в кластере — допишите namespace и сервис ниже.
            </div>
          )}
        </div>
      )}

      {mode === "link" && (
        <div className="field">
          <label>Ссылка на дашборд Grafana</label>
          <div className="inline analysis-link-row">
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://grafana.example/d/abc123/service?var-namespace=payments&var-service=api&from=now-2h&to=now"
              spellCheck={false}
            />
            <button type="button" className="ghost" onClick={applyLink} disabled={parsing || !link.trim()}>
              {parsing ? "…" : "Разобрать"}
            </button>
          </div>
          <div className="hint">
            Портал по ссылке не ходит — только читает переменные из адреса: cluster, namespace,
            service, container и период.
          </div>
          {linkNote && <div className="hint analysis-link-note">{linkNote}</div>}
        </div>
      )}

      <h3>Цель</h3>
      <div className="row">
        <div className="field">
          <label>Кластер</label>
          <input
            value={target.cluster}
            onChange={(e) => setTarget({ ...target, cluster: e.target.value })}
            placeholder="prod-dc1"
            spellCheck={false}
          />
        </div>
        <div className="field">
          <label>Namespace</label>
          <input
            value={target.namespace}
            onChange={(e) => setTarget({ ...target, namespace: e.target.value })}
            placeholder="payments"
            spellCheck={false}
          />
        </div>
        <div className="field">
          <label>Сервис</label>
          <input
            value={target.service}
            onChange={(e) => setTarget({ ...target, service: e.target.value })}
            placeholder="payment-api"
            spellCheck={false}
          />
        </div>
        <div className="field">
          <label>Контейнер</label>
          <input
            value={target.container}
            onChange={(e) => setTarget({ ...target, container: e.target.value })}
            placeholder="как сервис"
            spellCheck={false}
          />
        </div>
      </div>

      <h3>Период теста</h3>
      <div className="inline analysis-presets">
        <span className="muted">последние:</span>
        {WINDOW_PRESETS.map((p) => (
          <button type="button" key={p.id} className="ghost small" onClick={() => applyPreset(p.minutes)}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="row">
        <div className="field">
          <label>Начало</label>
          <input type="datetime-local" value={fromLocal} onChange={(e) => setFromLocal(e.target.value)} />
        </div>
        <div className="field">
          <label>Конец</label>
          <input type="datetime-local" value={toLocal} onChange={(e) => setToLocal(e.target.value)} />
        </div>
      </div>

      <h3>Контекст теста</h3>
      <p className="hint analysis-kind-lead">
        Тип теста меняет логику: на плато ищется дрейф, в поиске максимума — точка перелома.
        SLO подставляются в правила порогов; пусто — берутся значения из каталога.
      </p>
      <div className="inline analysis-kinds">
        {(Object.keys(TEST_KIND_META) as TestKind[]).map((kind) => (
          <button
            type="button"
            key={kind}
            className={`pill-source pill-engine ${testKind === kind ? "active" : ""}`}
            onClick={() => setTestKind(kind)}
          >
            {TEST_KIND_META[kind].label}
            <span className="pill-engine-tagline">{TEST_KIND_META[kind].hint}</span>
          </button>
        ))}
      </div>
      <div className="row">
        <div className="field">
          <label>SLO p99, мс</label>
          <input
            value={sloP99}
            onChange={(e) => setSloP99(e.target.value.replace(/[^\d.]/g, ""))}
            placeholder="например 500"
            inputMode="decimal"
          />
        </div>
        <div className="field">
          <label>SLO ошибок, %</label>
          <input
            value={sloErrors}
            onChange={(e) => setSloErrors(e.target.value.replace(/[^\d.]/g, ""))}
            placeholder="например 0.5"
            inputMode="decimal"
          />
        </div>
      </div>

      <section className={`demo-box ${demo ? "on" : ""}`}>
        <label className="demo-toggle">
          <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} />
          <span>
            <strong>Показать на демо-данных</strong>
            <span className="muted">
              {" "}
              — синтетический прогон с заранее заложенным дефектом. Кластер и метрики не нужны:
              удобно понять, что модуль вообще выдаёт.
            </span>
          </span>
        </label>
        {demo && (
          <div className="inline demo-faults">
            {DEMO_FAULTS.map((f) => (
              <button
                type="button"
                key={f.id}
                className={`pill-source ${demoFault === f.id ? "active" : ""}`}
                onClick={() => setDemoFault(f.id)}
                title={f.hint}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </section>

      {error && <div className="error">{error}</div>}

      <div className="footer-nav">
        <span className="hint">
          {demo
            ? "Демо-режим: данные синтетические, отчёт помечен."
            : canSubmit
              ? "Анализ считается в фоне — отчёт откроется, как только будет готов."
              : "Заполните namespace и сервис или включите демо-режим."}
        </span>
        <button type="button" className="success" onClick={submit} disabled={loading || !canSubmit}>
          {loading ? "Ставим в очередь…" : "Проанализировать"}
        </button>
      </div>
    </section>
  );
}
