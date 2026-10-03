"use client";

import { useCallback, useMemo, useState } from "react";
import type { Intensity, RequestModel, Scenario, TestMode } from "@/lib/types";
import { downloadBlob, generateScript, saveBuild } from "@/lib/api";
import { groupRequests, groupTitle, groupIntensity } from "@/lib/grouping";
import { arrivalRate, formatRps, groupProfile, requestShareRps, samplesPerIteration } from "@/lib/profile";
import { ENGINE_META, ENGINES, runCommand, type Engine } from "@/lib/engines";
import { LoadChart, CHART_COLORS, type Series } from "@/components/LoadChart";
import { BuildHistory } from "@/components/BuildHistory";
import { analyzeScenario } from "@/lib/readiness";
import { NumberField } from "@/components/NumberField";
import { MetricsSection } from "@/components/intensity/MetricsSection";
import { AutostopSection } from "@/components/intensity/AutostopSection";
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

  function reqRps(g: (typeof groups)[number], repeat: number): number {
    return requestShareRps(
      groupIntensity(g).target_rps,
      repeat,
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
        `Сборка сохранена · build_id=${saved.build_id.slice(0, 8)}… · script_id=${saved.script_id.slice(0, 8)}…`
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

      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="field" style={{ flex: "none", minWidth: 420 }}>
          <label>Движок сборки</label>
          <div className="inline">
            {ENGINES.map((e) => (
              <div
                key={e.id}
                className={`pill-source pill-engine ${engine === e.id ? "active" : ""}`}
                onClick={() => setEngine(e.id)}
              >
                {e.label}
                <span className="pill-engine-tagline">{e.tagline}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="hint" style={{ marginTop: -4 }}>
        {meta.rpsHint}
      </div>

      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="field" style={{ flex: "none", minWidth: 260 }}>
          <label>Режим теста</label>
          <div className="inline">
            <div
              className={`pill-source ${!maxSearch ? "active" : ""}`}
              onClick={() => setLoad({ test_mode: "ramp_hold" as TestMode })}
            >
              Постоянная нагрузка
            </div>
            <div
              className={`pill-source ${maxSearch ? "active" : ""}`}
              onClick={() => setLoad({ test_mode: "max_search" as TestMode })}
            >
              Поиск максимума
            </div>
          </div>
        </div>
        {meta.needsLatency && (
          <div className="field" style={{ width: 150, flex: "none" }}>
            <label>Ожид. латентность, сек</label>
            <NumberField
              fieldId="assumed-latency"
              value={load.assumed_latency_sec}
              min={0}
              onCommit={(n) => setLoad({ assumed_latency_sec: n })}
            />
          </div>
        )}
        {maxSearch && (
          <>
            <div className="field" style={{ width: 130, flex: "none" }}>
              <label>Кол-во ступеней</label>
              <NumberField
                fieldId="load-steps"
                value={load.steps}
                min={1}
                onCommit={(n) => setLoad({ steps: Math.max(1, n) })}
              />
            </div>
            <div className="field" style={{ width: 150, flex: "none" }}>
              <label>Длительность ступени, с</label>
              <NumberField
                fieldId="step-duration"
                value={load.step_duration_sec}
                min={1}
                onCommit={(n) => setLoad({ step_duration_sec: Math.max(1, n) })}
              />
            </div>
          </>
        )}
      </div>
      <div className="hint">
        {meta.modeHint(maxSearch)}
        {!meta.needsLatency && " Пул пользователей не задаётся: они создаются по мере поступления."}
      </div>

      {!maxSearch && (
        <div className="row" style={{ alignItems: "flex-end", marginTop: 8 }}>
          <div className="field" style={{ flex: "none" }}>
            <label>Общий Ramp-up</label>
            <label className="inline" style={{ textTransform: "none" }}>
              <input
                type="checkbox"
                style={{ width: "auto" }}
                checked={sharedRamp}
                onChange={(e) => {
                  setSharedRamp(e.target.checked);
                  if (e.target.checked && first) setAllGroups({ ramp_up_sec: first.ramp_up_sec });
                }}
              />
              <span className="muted">одно значение на все группы</span>
            </label>
          </div>
          {sharedRamp && first && (
            <div className="field" style={{ width: 140, flex: "none" }}>
              <label>Ramp-up (общий), с</label>
              <NumberField
                fieldId="shared-ramp"
                value={first.ramp_up_sec}
                min={0}
                onCommit={(n) => setAllGroups({ ramp_up_sec: n })}
                onValidity={markField}
              />
            </div>
          )}
          <div className="field" style={{ flex: "none" }}>
            <label>Общее удержание</label>
            <label className="inline" style={{ textTransform: "none" }}>
              <input
                type="checkbox"
                style={{ width: "auto" }}
                checked={sharedHold}
                onChange={(e) => {
                  setSharedHold(e.target.checked);
                  if (e.target.checked && first) setAllGroups({ hold_sec: first.hold_sec });
                }}
              />
              <span className="muted">одно значение на все группы</span>
            </label>
          </div>
          {sharedHold && first && (
            <div className="field" style={{ width: 140, flex: "none" }}>
              <label>Удержание (общее), с</label>
              <NumberField
                fieldId="shared-hold"
                value={first.hold_sec}
                min={1}
                onCommit={(n) => setAllGroups({ hold_sec: n })}
                onValidity={markField}
              />
            </div>
          )}
        </div>
      )}

      <h3 style={{ fontSize: 13, marginTop: 16 }}>Профиль тест-плана</h3>
      <div className="chart-wrap">
        <div className="chart-box">
          <LoadChart series={series} />
        </div>
        <div className="peak-box">
          <div className="lbl">Суммарный пик</div>
          <div className="val">{formatRps(peakTotal)}</div>
          <div className="lbl">HTTP запросов/сек</div>
        </div>
      </div>

      <h3 style={{ fontSize: 13, marginTop: 16 }}>Интенсивность по группам</h3>
      <p className="muted" style={{ marginTop: -6 }}>
        Связанные корреляцией и общим CSV запросы — одна группа, один целевой HTTP RPS.
        «×N» — сколько раз запрос бьётся за итерацию ({meta.short}: {meta.repeatTitle}). Доля
        ≈RPS пропорциональна ×N. Пример: 1× логин → 5× витрина.
      </p>
      <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Группа</th>
            <th style={{ width: 150 }}>Целевой RPS (HTTP){maxSearch ? " · пик" : ""}</th>
            {!maxSearch && <th style={{ width: 110 }}>Ramp-up, с</th>}
            {!maxSearch && <th style={{ width: 120 }}>Удержание, с</th>}
          </tr>
        </thead>
        <tbody>
          {groups.map((g, i) => {
            const samples = samplesPerIteration(g.requests);
            const httpRps = groupIntensity(g).target_rps;
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
                {g.requests.map((r) => (
                  <span key={r.id} style={{ marginRight: 10, whiteSpace: "nowrap" }}>
                    <span className={`method ${r.method}`}>{r.method}</span> {r.name}
                    <span className="muted" style={{ marginLeft: 4 }}>
                      ×
                      <NumberField
                        fieldId={`repeat-${r.id}`}
                        value={r.repeat}
                        min={1}
                        title={meta.repeatTitle}
                        style={{ width: 46, padding: "2px 4px", marginLeft: 2 }}
                        onCommit={(n) => updateRequest(r.id, { repeat: n })}
                        onValidity={markField}
                      />
                    </span>
                    <span
                      className="tag"
                      title="доля HTTP RPS запроса от целевого RPS группы (∝ ×N)"
                      style={{ marginLeft: 4 }}
                    >
                      ≈{formatRps(reqRps(g, r.repeat))} HTTP/с
                    </span>
                  </span>
                ))}
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
                    {samples} HTTP за итерацию
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
                    title={sharedRamp ? "управляется общим значением выше" : undefined}
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
                    title={sharedHold ? "управляется общим значением выше" : undefined}
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

      <MetricsSection
        engine={engine}
        scenarioName={scenario.name}
        prom={prom}
        setPrometheus={setPrometheus}
      />

      <AutostopSection engine={engine} autostop={autostop} setAutostop={setAutostop} />

      {error && (
        <div className="error" style={{ marginTop: 12 }}>
          Ошибка сборки: {error}
        </div>
      )}
      {done && (
        <div
          className="error"
          style={{
            marginTop: 12,
            background: "rgba(111,138,86,0.16)",
            borderColor: "var(--ok)",
          }}
        >
          Собрано и скачано: <code>{done}</code>.{" "}
          {engine === "k6" ? (
            <>
              Распакуйте архив и запустите <code>{runCommand(engine, done)}</code>. Библиотеки
              лежат в <code>lib/</code>, доступ к jslib.k6.io не нужен.
            </>
          ) : engine === "gatling" ? (
            <>
              В архиве — Maven-проект: <code>pom.xml</code>, <code>PortalSimulation.java</code>,{" "}
              <code>gatling.conf</code> и CSV. Запуск: <code>{runCommand(engine, done)}</code>{" "}
              (JDK 17+, Gatling подтянется как зависимость).
            </>
          ) : done.endsWith(".zip") ? (
            <>
              В архиве — <code>.jmx</code> и CSV-датасеты: распакуйте и откройте{" "}
              <code>.jmx</code> в JMeter. Нужны плагины <code>jpgc-casutg</code> и{" "}
              <code>jpgc-tst</code>.
            </>
          ) : (
            <>
              Откройте файл в JMeter. Нужны плагины <code>jpgc-casutg</code> и{" "}
              <code>jpgc-tst</code>.
            </>
          )}
        </div>
      )}

      {savedHint && (
        <div className="hint" style={{ marginTop: 12 }}>
          {savedHint}
        </div>
      )}

      <h3 style={{ fontSize: 13, marginTop: 18 }}>Сборка · {meta.short}</h3>

      <BuildHistory
        refreshKey={historyKey}
        onRestore={onRestoreScenario}
        currentScenario={scenario}
        defaultEngine={engine}
      />

      <div className="hint" style={{ marginTop: -6 }}>
        {meta.buildHint}
      </div>

      {readiness.blockers > 0 && (
        <div className="error" style={{ marginTop: 12 }}>
          В «Пульсе сценария» {readiness.blockers} критических замечаний — сохранение и выгрузка
          доступны, но перед запуском лучше исправить блокеры.
        </div>
      )}

      <div className="footer-nav step4-actions">
        <button className="ghost" onClick={onBack}>
          ← Назад
        </button>
        <div className="step4-actions-primary">
          <button
            className="ghost"
            onClick={build}
            disabled={building || saving || groups.length === 0 || !intensityReady}
            title={`Скачать ${meta.artifact} без записи в историю сборок`}
          >
            {building ? "Собираем…" : "Выгрузить скрипт"}
          </button>
          <button
            className="ghost"
            onClick={saveOnly}
            disabled={building || saving || groups.length === 0 || !intensityReady}
          >
            {saving ? "…" : "Сохранить сборку"}
          </button>
          <button
            className="success"
            onClick={goToRun}
            disabled={building || saving || groups.length === 0 || !onGoToRun || !intensityReady}
            title={
              readiness.blockers > 0
                ? `Есть ${readiness.blockers} блокер(ов) в пульсе — можно сохранить и перейти к запуску`
                : "Сохранить сборку и перейти к запуску"
            }
          >
            {saving ? "Готовим…" : "К запуску теста →"}
          </button>
        </div>
      </div>
    </div>
  );
}
