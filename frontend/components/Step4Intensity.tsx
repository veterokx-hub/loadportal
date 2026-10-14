"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Intensity, RequestModel, Scenario, TestMode } from "@/lib/types";
import { downloadBlob, generateScript, saveBuild } from "@/lib/api";
import { groupRequests, groupTitle, groupIntensity } from "@/lib/grouping";
import {
  arrivalRate,
  formatRps,
  groupProfile,
  iterationWeights,
  requestShareRps,
  samplesPerIteration,
  throughputPercent,
} from "@/lib/profile";
import { ENGINE_META, ENGINES, runCommand, type Engine } from "@/lib/engines";
import { LoadChart, CHART_COLORS, type Series } from "@/components/LoadChart";
import { BuildHistory } from "@/components/BuildHistory";
import { healthMark, revealHealth, useHealthFocus } from "@/lib/health-focus";
import { analyzeScenario } from "@/lib/readiness";
import { NumberField } from "@/components/NumberField";
import { MetricsSection } from "@/components/intensity/MetricsSection";
import { AutostopSection } from "@/components/intensity/AutostopSection";
import { FormSection } from "@/components/intensity/FormSection";
import { usePortal } from "@/context/PortalContext";

export function Step4Intensity({
  scenario,
  setScenario,
  updateRequest,
  onRestoreScenario,
  onBack,
  onGoToRun,
}: {
  scenario: Scenario;
  setScenario: (s: Scenario) => void;
  updateRequest: (id: string, patch: Partial<RequestModel>) => void;
  onRestoreScenario: (s: Scenario) => void;
  onBack: () => void;
  onGoToRun?: (buildId: string) => void;
}) {
  const [building, setBuilding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [savedHint, setSavedHint] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const [sharedRamp, setSharedRamp] = useState(false);
  const [sharedHold, setSharedHold] = useState(false);
  const [engine, setEngine] = useState<Engine>("jmeter");
  const [invalidFields, setInvalidFields] = useState<Record<string, boolean>>({});
  const { markScenarioSaved } = usePortal();

  const markField = useCallback((id: string, ok: boolean) => {
    setInvalidFields((prev) => {
      const was = prev[id];
      if (ok && was === undefined) return prev;
      if (ok) {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      if (was === true) return prev;
      return { ...prev, [id]: true };
    });
  }, []);

  const intensityReady = Object.keys(invalidFields).length === 0;

  const load = scenario.load;
  const maxSearch = load.test_mode === "max_search";
  const meta = ENGINE_META[engine];

  const groups = useMemo(() => groupRequests(scenario), [scenario]);
  const readiness = useMemo(() => analyzeScenario(scenario), [scenario]);
  const health = useHealthFocus();

  useEffect(() => {
    if (!health || health.step !== 3) return;
    const timer = window.setTimeout(() => revealHealth(health), 50);
    return () => window.clearTimeout(timer);
  }, [health]);

  const series: Series[] = groups.map((g, i) => ({
    label: groupTitle(g),
    color: CHART_COLORS[i % CHART_COLORS.length],
    points: groupProfile(groupIntensity(g), load),
  }));

  const peakTotal = groups.reduce((acc, g) => acc + Math.max(0, groupIntensity(g).target_rps), 0);

  const autostop = scenario.autostop;
  const prom = scenario.prometheus;

  function setLoad(patch: Partial<typeof load>) {
    setScenario({ ...scenario, load: { ...load, ...patch } });
  }

  function setAutostop(patch: Partial<typeof autostop>) {
    setScenario({ ...scenario, autostop: { ...autostop, ...patch } });
  }

  function setPrometheus(patch: Partial<typeof prom>) {
    setScenario({ ...scenario, prometheus: { ...prom, ...patch } });
  }

  function setGroupIntensity(groupKey: string, patch: Partial<Intensity>) {
    const g = groups.find((x) => x.key === groupKey);
    if (!g) return;
    g.requests.forEach((r) =>
      updateRequest(r.id, { intensity: { ...r.intensity, ...patch } })
    );
  }

  function setAllGroups(patch: Partial<Intensity>) {
    scenario.requests.forEach((r) =>
      updateRequest(r.id, { intensity: { ...r.intensity, ...patch } })
    );
  }

  const first = groups[0] ? groupIntensity(groups[0]) : null;

  function reqRps(g: (typeof groups)[number], percent: number): number {
    return requestShareRps(
      groupIntensity(g).target_rps,
      percent,
      samplesPerIteration(g.requests)
    );
  }

  async function build() {
    if (!intensityReady) {
      setError("Заполните все поля интенсивности");
      return;
    }
    setBuilding(true);
    setError(null);
    setDone(null);
    setSavedHint(null);
    try {
      // Выгрузка без истории: разовая генерация, без build_id / script_id.
      const { blob, filename } = await generateScript(scenario, engine);
      downloadBlob(blob, filename);
      setDone(filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBuilding(false);
    }
  }

  async function saveOnly() {
    if (!intensityReady) {
      setError("Заполните все поля интенсивности");
      return;
    }
    setSaving(true);
    setError(null);
    setSavedHint(null);
    try {
      const saved = await saveBuild(scenario, engine);
      markScenarioSaved();
      setSavedHint(
        `Сборка сохранена: build ${saved.build_id.slice(0, 8)}…, script ${saved.script_id.slice(0, 8)}…`
      );
      setHistoryKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function goToRun() {
    if (!intensityReady) {
      setError("Заполните все поля интенсивности");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await saveBuild(scenario, engine);
      markScenarioSaved();
      setHistoryKey((k) => k + 1);
      onGoToRun?.(saved.build_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel">
      <h2>4. Интенсивность и сборка</h2>

      <FormSection title="Движок и режим" lead={meta.rpsHint}>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ flex: "none" }}>
            <label>Движок</label>
            <div className="inline">
              {ENGINES.map((e) => (
                <button
                  type="button"
                  aria-pressed={engine === e.id}
                  key={e.id}
                  className={`pill-source pill-engine ${engine === e.id ? "active" : ""}`}
                  onClick={() => setEngine(e.id)}
                >
                  {e.label}
                  <span className="pill-engine-tagline">{e.tagline}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="field" style={{ flex: "none" }}>
            <label>Режим</label>
            <div className="inline">
              <button
                type="button"
                aria-pressed={!maxSearch}
                className={`pill-source ${!maxSearch ? "active" : ""}`}
                onClick={() => setLoad({ test_mode: "ramp_hold" as TestMode })}
              >
                Постоянная нагрузка
              </button>
              <button
                type="button"
                aria-pressed={maxSearch}
                className={`pill-source ${maxSearch ? "active" : ""}`}
                onClick={() => setLoad({ test_mode: "max_search" as TestMode })}
              >
                Поиск максимума
              </button>
            </div>
          </div>
        </div>
        <div className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
          {meta.modeHint(maxSearch)}
        </div>

        {(meta.needsLatency || maxSearch) && (
          <div className="compact-grid">
            {meta.needsLatency && (
              <div className="field span-3">
                <label title="Средний отклик, по которому считается пул потоков или VU">
                  Ожидаемая латентность, с
                </label>
                <NumberField
                  fieldId="assumed-latency"
                  value={load.assumed_latency_sec}
                  min={0}
                  title="Средний отклик, по которому считается пул потоков или VU"
                  onCommit={(n) => setLoad({ assumed_latency_sec: n })}
                />
              </div>
            )}
            {maxSearch && (
              <div className="field span-3">
                <label>Ступеней</label>
                <NumberField
                  fieldId="load-steps"
                  value={load.steps}
                  min={1}
                  onCommit={(n) => setLoad({ steps: Math.max(1, n) })}
                />
              </div>
            )}
            {maxSearch && (
              <div className="field span-3">
                <label>Ступень, с</label>
                <NumberField
                  fieldId="step-duration"
                  value={load.step_duration_sec}
                  min={1}
                  onCommit={(n) => setLoad({ step_duration_sec: Math.max(1, n) })}
                />
              </div>
            )}
          </div>
        )}

        {!maxSearch && (
          <div className="row" style={{ gap: 24, marginBottom: 12 }}>
            <div className="toggle-field">
              <label className="check-inline">
                <input
                  type="checkbox"
                  checked={sharedRamp}
                  onChange={(e) => {
                    setSharedRamp(e.target.checked);
                    if (e.target.checked && first) setAllGroups({ ramp_up_sec: first.ramp_up_sec });
                  }}
                />
                Общий ramp-up
              </label>
              {sharedRamp && first && (
                <>
                  <NumberField
                    fieldId="shared-ramp"
                    value={first.ramp_up_sec}
                    min={0}
                    title="Ramp-up для всех групп"
                    onCommit={(n) => setAllGroups({ ramp_up_sec: n })}
                    onValidity={markField}
                  />
                  <span className="muted">с</span>
                </>
              )}
            </div>
            <div className="toggle-field">
              <label className="check-inline">
                <input
                  type="checkbox"
                  checked={sharedHold}
                  onChange={(e) => {
                    setSharedHold(e.target.checked);
                    if (e.target.checked && first) setAllGroups({ hold_sec: first.hold_sec });
                  }}
                />
                Общее удержание
              </label>
              {sharedHold && first && (
                <>
                  <NumberField
                    fieldId="shared-hold"
                    value={first.hold_sec}
                    min={1}
                    title="Удержание для всех групп"
                    onCommit={(n) => setAllGroups({ hold_sec: n })}
                    onValidity={markField}
                  />
                  <span className="muted">с</span>
                </>
              )}
            </div>
          </div>
        )}
      </FormSection>

      <FormSection title="Профиль нагрузки">
        <div className="chart-wrap">
          <div className="chart-box">
            <LoadChart series={series} />
          </div>
          <div className="peak-box">
            <div className="lbl">Суммарный пик</div>
            <div className="val">{formatRps(peakTotal)}</div>
            <div className="lbl">HTTP-запросов/с</div>
          </div>
        </div>
      </FormSection>

      <FormSection
        mark={healthMark("intensity")}
        title="Интенсивность по группам"
        lead="Запросы, связанные корреляцией или общим CSV, — одна группа с одним целевым RPS. Процент — доля итераций, в которых запрос выполняется."
        details={[
          <>{meta.throughputTitle}.</>,
          <>
            100% — каждый проход. Меньше — реже, доля RPS пропорциональна проценту. Пример: логин 20% и витрина 100% дают соотношение 1:5.
          </>,
          <>
            Если запрос с извлечением переменной реже 100%, следующий запрос группы иногда пойдёт без нового значения. В smoke каждый запрос выполняется всегда.
          </>,
        ]}
      >
        <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Группа</th>
              <th style={{ width: 150 }}>Целевой RPS{maxSearch ? " · пик" : ""}</th>
              {!maxSearch && <th style={{ width: 110 }}>Ramp-up, с</th>}
              {!maxSearch && <th style={{ width: 120 }}>Удержание, с</th>}
            </tr>
          </thead>
          <tbody>
            {groups.map((g, i) => {
              const samples = samplesPerIteration(g.requests);
              const weights = iterationWeights(g.requests);
              const httpRps = groupIntensity(g).target_rps;
              const balanced = g.requests.length > 1;
              return (
              <tr key={g.key}>
                <td>
                  <span
                    className="swatch"
                    style={{
                      background: CHART_COLORS[i % CHART_COLORS.length],
                      display: "inline-block",
                      width: 10,
                      height: 10,
                      marginRight: 8,
                    }}
                  />
                  {g.requests.map((r, ri) => {
                    const percent = Math.round(weights[ri] * 100);
                    return (
                    <span key={r.id} style={{ marginRight: 10, whiteSpace: "nowrap" }}>
                      <span className={`method ${r.method}`}>{r.method}</span> {r.name}
                      {balanced && (
                        <>
                          <span className="muted" style={{ marginLeft: 4 }}>
                            <NumberField
                              fieldId={`throughput-${r.id}`}
                              value={r.throughput ?? percent}
                              min={1}
                              title={meta.throughputTitle}
                              style={{ width: 52, padding: "2px 4px", marginLeft: 2 }}
                              onCommit={(n) =>
                                updateRequest(r.id, {
                                  throughput: throughputPercent(n),
                                  repeat: 1,
                                })
                              }
                              onValidity={markField}
                            />
                            %
                          </span>
                          <span
                            className="tag"
                            title="Доля RPS группы, приходящаяся на запрос (пропорционально проценту)"
                            style={{ marginLeft: 4 }}
                          >
                            ≈{formatRps(reqRps(g, percent))}/с
                          </span>
                        </>
                      )}
                    </span>
                    );
                  })}
                  {g.datasetIds.length > 0 && <span className="badge">CSV</span>}
                </td>
                <td>
                  <NumberField
                    fieldId={`rps-${g.key}`}
                    value={httpRps}
                    min={0}
                    step="any"
                    onCommit={(n) => setGroupIntensity(g.key, { target_rps: n })}
                    onValidity={markField}
                  />
                  {meta.derivedLabel && samples > 1 && (
                    <div className="muted" style={{ fontSize: 11, marginTop: 4, lineHeight: 1.35 }}>
                      {meta.derivedLabel} {formatRps(arrivalRate(httpRps, samples))}/с
                      <br />
                      {formatRps(samples)} HTTP за итерацию
                    </div>
                  )}
                </td>
                {!maxSearch && (
                  <td>
                    <NumberField
                      fieldId={`ramp-${g.key}`}
                      value={groupIntensity(g).ramp_up_sec}
                      min={0}
                      disabled={sharedRamp}
                      title={sharedRamp ? "Задаётся общим ramp-up" : undefined}
                      onCommit={(n) => setGroupIntensity(g.key, { ramp_up_sec: n })}
                      onValidity={markField}
                    />
                  </td>
                )}
                {!maxSearch && (
                  <td>
                    <NumberField
                      fieldId={`hold-${g.key}`}
                      value={groupIntensity(g).hold_sec}
                      min={1}
                      disabled={sharedHold}
                      title={sharedHold ? "Задаётся общим удержанием" : undefined}
                      onCommit={(n) => setGroupIntensity(g.key, { hold_sec: n })}
                      onValidity={markField}
                    />
                  </td>
                )}
              </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </FormSection>

      <MetricsSection
        engine={engine}
        scenarioName={scenario.name}
        prom={prom}
        setPrometheus={setPrometheus}
      />

      <div data-health={healthMark("autostop")}>
        <AutostopSection engine={engine} autostop={autostop} setAutostop={setAutostop} />
      </div>

      <FormSection
        title="Сборка"
        aside={<span className="tag">{meta.short} · {meta.artifact}</span>}
        lead={meta.buildHint}
      >
        <BuildHistory
          refreshKey={historyKey}
          onRestore={onRestoreScenario}
          currentScenario={scenario}
          defaultEngine={engine}
        />
      </FormSection>

      {readiness.blockers > 0 && (
        <div className="notice warn">
          В «Пульсе сценария» блокеров: {readiness.blockers}. Сохранить и выгрузить можно, но перед
          запуском их лучше исправить.
        </div>
      )}

      {error && <div className="error" style={{ marginTop: 12 }}>Ошибка сборки: {error}</div>}

      {done && (
        <div className="notice ok">
          Скачано: <code>{done}</code>.{" "}
          {engine === "k6" ? (
            <>
              Распакуйте и запустите <code>{runCommand(engine, done)}</code>. Библиотеки — в{" "}
              <code>lib/</code>, доступ к jslib.k6.io не нужен.
            </>
          ) : engine === "gatling" ? (
            <>
              Maven-проект: <code>pom.xml</code>, <code>PortalSimulation.java</code>,{" "}
              <code>gatling.conf</code> и CSV. Запуск — <code>{runCommand(engine, done)}</code>, нужен
              JDK 17+.
            </>
          ) : done.endsWith(".zip") ? (
            <>
              Распакуйте и откройте <code>.jmx</code> в JMeter. Нужны плагины <code>jpgc-casutg</code>{" "}
              и <code>jpgc-tst</code>.
            </>
          ) : (
            <>
              Откройте в JMeter. Нужны плагины <code>jpgc-casutg</code> и <code>jpgc-tst</code>.
            </>
          )}
        </div>
      )}

      {savedHint && <div className="notice ok">{savedHint}</div>}

      <div className="footer-nav step4-actions">
        <button className="ghost" onClick={onBack}>
          ← Назад
        </button>
        <div className="step4-actions-primary">
          <button
            className="ghost"
            onClick={build}
            disabled={building || saving || groups.length === 0 || !intensityReady}
            title={`Скачать ${meta.artifact} без записи в историю`}
          >
            {building ? "Собираем…" : "Выгрузить скрипт"}
          </button>
          <button
            className="ghost"
            onClick={saveOnly}
            disabled={building || saving || groups.length === 0 || !intensityReady}
            title="Записать в историю сборок без перехода к запуску"
          >
            {saving ? "Сохраняем…" : "Сохранить сборку"}
          </button>
          <button
            className="success"
            onClick={goToRun}
            disabled={building || saving || groups.length === 0 || !onGoToRun || !intensityReady}
            title={
              readiness.blockers > 0
                ? `Блокеров в пульсе: ${readiness.blockers}. Сборку можно сохранить и запустить`
                : "Сохранить сборку и перейти к запуску"
            }
          >
            {saving ? "Готовим…" : "К запуску →"}
          </button>
        </div>
      </div>
    </div>
  );
}
