"use client";

import { useMemo, useState } from "react";
import type { Intensity, RequestModel, Scenario, TestMode } from "@/lib/types";
import { downloadBlob, downloadScript, saveBuild } from "@/lib/api";
import { groupRequests, groupTitle, groupIntensity } from "@/lib/grouping";
import { groupProfile } from "@/lib/profile";
import { LoadChart, CHART_COLORS, type Series } from "@/components/LoadChart";
import { BuildHistory } from "@/components/BuildHistory";
import { analyzeScenario } from "@/lib/readiness";

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
  const [engine, setEngine] = useState<"jmeter" | "k6">("jmeter");

  const load = scenario.load;
  const maxSearch = load.test_mode === "max_search";

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

  /** Расчётный RPS запроса внутри группы с учётом повторов (Loop Controller).
   *  TST ограничивает суммарный поток группы; доля запроса ∝ его повторам. */
  function reqRps(g: (typeof groups)[number], repeat: number): number {
    const sum = g.requests.reduce((a, r) => a + Math.max(1, r.repeat), 0);
    const total = Math.max(0, groupIntensity(g).target_rps);
    return sum > 0 ? (total * Math.max(1, repeat)) / sum : 0;
  }

  async function build() {
    setBuilding(true);
    setError(null);
    setDone(null);
    setSavedHint(null);
    try {
      const saved = await saveBuild(scenario, engine);
      const { blob, filename } = await downloadScript(saved.script_id);
      downloadBlob(blob, filename);
      setDone(filename);
      setHistoryKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBuilding(false);
    }
  }

  async function saveOnly() {
    setSaving(true);
    setError(null);
    setSavedHint(null);
    try {
      const saved = await saveBuild(scenario, engine);
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
    setSaving(true);
    setError(null);
    try {
      const saved = await saveBuild(scenario, engine);
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

      <div className="row">
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
        <div className="field" style={{ width: 150, flex: "none" }}>
          <label>Ожид. латентность, сек</label>
          <input
            type="number"
            step="0.1"
            value={load.assumed_latency_sec}
            onChange={(e) => setLoad({ assumed_latency_sec: Number(e.target.value) })}
          />
        </div>
        {maxSearch && (
          <>
            <div className="field" style={{ width: 130, flex: "none" }}>
              <label>Кол-во ступеней</label>
              <input
                type="number"
                min={1}
                value={load.steps}
                onChange={(e) => setLoad({ steps: Math.max(1, Number(e.target.value)) })}
              />
            </div>
            <div className="field" style={{ width: 150, flex: "none" }}>
              <label>Длительность ступени, с</label>
              <input
                type="number"
                min={1}
                value={load.step_duration_sec}
                onChange={(e) => setLoad({ step_duration_sec: Math.max(1, Number(e.target.value)) })}
              />
            </div>
          </>
        )}
      </div>
      <div className="hint">
        {maxSearch
          ? "Поле «Целевой RPS» — ПИК. Лестница поднимается от пик/N до пика за N ступеней."
          : "Каждая группа = Concurrency Thread Group + Throughput Shaping Timer (ramp-up → удержание)."}
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
              <input
                type="number"
                min={0}
                value={first.ramp_up_sec}
                onChange={(e) => setAllGroups({ ramp_up_sec: Number(e.target.value) })}
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
              <input
                type="number"
                min={1}
                value={first.hold_sec}
                onChange={(e) => setAllGroups({ hold_sec: Number(e.target.value) })}
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
          <div className="val">{peakTotal.toFixed(peakTotal < 10 ? 1 : 0)}</div>
          <div className="lbl">запросов/сек</div>
        </div>
      </div>

      <h3 style={{ fontSize: 13, marginTop: 16 }}>Интенсивность по группам</h3>
      <p className="muted" style={{ marginTop: -6 }}>
        Связанные корреляцией и общим CSV запросы объединены — интенсивность у них
        единая. Внутри группы задайте «×N» для запроса, чтобы он выполнялся чаще
        (Loop Controller): напр. 1× получить счёт → 5× запросить по нему данные.
      </p>
      <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Группа (тред-группа)</th>
            <th style={{ width: 120 }}>Целевой RPS {maxSearch ? "(пик)" : ""}</th>
            {!maxSearch && <th style={{ width: 110 }}>Ramp-up, с</th>}
            {!maxSearch && <th style={{ width: 120 }}>Удержание, с</th>}
          </tr>
        </thead>
        <tbody>
          {groups.map((g, i) => (
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
                    {g.requests.length > 1 && (
                      <span className="muted" style={{ marginLeft: 4 }}>
                        ×
                        <input
                          type="number"
                          min={1}
                          title="повторов за итерацию (Loop Controller)"
                          style={{ width: 46, padding: "2px 4px", marginLeft: 2 }}
                          value={r.repeat}
                          onChange={(e) =>
                            updateRequest(r.id, { repeat: Math.max(1, Number(e.target.value)) })
                          }
                        />
                      </span>
                    )}
                    <span
                      className="tag"
                      title="расчётный RPS запроса (доля от целевого RPS группы с учётом повторов)"
                      style={{ marginLeft: 4 }}
                    >
                      ≈{reqRps(g, r.repeat).toFixed(1)} rps
                    </span>
                  </span>
                ))}
                {g.datasetIds.length > 0 && <span className="badge">CSV</span>}
              </td>
              <td>
                <input
                  type="number"
                  step="0.1"
                  min={0}
                  value={groupIntensity(g).target_rps}
                  onChange={(e) =>
                    setGroupIntensity(g.key, { target_rps: Number(e.target.value) })
                  }
                />
              </td>
              {!maxSearch && (
                <td>
                  <input
                    type="number"
                    min={0}
                    disabled={sharedRamp}
                    title={sharedRamp ? "управляется общим значением выше" : undefined}
                    value={groupIntensity(g).ramp_up_sec}
                    onChange={(e) =>
                      setGroupIntensity(g.key, { ramp_up_sec: Number(e.target.value) })
                    }
                  />
                </td>
              )}
              {!maxSearch && (
                <td>
                  <input
                    type="number"
                    min={1}
                    disabled={sharedHold}
                    title={sharedHold ? "управляется общим значением выше" : undefined}
                    value={groupIntensity(g).hold_sec}
                    onChange={(e) =>
                      setGroupIntensity(g.key, { hold_sec: Number(e.target.value) })
                    }
                  />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      <h3 style={{ fontSize: 13, marginTop: 18 }}>Prometheus (JMeter, Колесников)</h3>
      <p className="muted" style={{ marginTop: -6 }}>
        Backend Listener <code>com.github.kolesnikovm.PrometheusListener</code> добавляется в
        каждый .jmx по умолчанию. Метрики на{" "}
        <code>http://localhost:{prom.exporter_port}/metrics</code> (хост задаётся при запуске JMeter).
      </p>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="field" style={{ width: 130, flex: "none" }}>
          <label>Порт exporter</label>
          <input
            type="number"
            min={1}
            max={65535}
            value={prom.exporter_port}
            onChange={(e) => setPrometheus({ exporter_port: Number(e.target.value) })}
          />
        </div>
        <div className="field" style={{ width: 100, flex: "none" }}>
          <label>runId</label>
          <input
            value={prom.run_id}
            onChange={(e) => setPrometheus({ run_id: e.target.value })}
          />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 200 }}>
          <label>samplersRegExp</label>
          <input
            value={prom.samplers_reg_exp}
            placeholder=".*"
            onChange={(e) => setPrometheus({ samplers_reg_exp: e.target.value })}
          />
        </div>
      </div>
      <div className="hint">
        <code>testName</code> = название сценария ({scenario.name || "scenario"}). Плагин:{" "}
        <code>jmeter-prometheus-listener</code> в <code>lib/ext</code>.
      </div>

      <h3 style={{ fontSize: 13, marginTop: 18 }}>AutoStop (авто-остановка теста)</h3>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="field" style={{ flex: "none" }}>
          <label>Включить</label>
          <label className="inline" style={{ textTransform: "none" }}>
            <input
              type="checkbox"
              style={{ width: "auto" }}
              checked={autostop.enabled}
              onChange={(e) => setAutostop({ enabled: e.target.checked })}
            />
            <span className="muted">плагин jpgc-autostop</span>
          </label>
        </div>
        {autostop.enabled && (
          <>
            <div className="field" style={{ width: 130, flex: "none" }}>
              <label>Ошибки, %</label>
              <input
                type="number"
                value={autostop.error_rate_pct}
                onChange={(e) => setAutostop({ error_rate_pct: Number(e.target.value) })}
              />
            </div>
            <div className="field" style={{ width: 130, flex: "none" }}>
              <label>...в течение, с</label>
              <input
                type="number"
                value={autostop.error_rate_sec}
                onChange={(e) => setAutostop({ error_rate_sec: Number(e.target.value) })}
              />
            </div>
            <div className="field" style={{ width: 150, flex: "none" }}>
              <label>Ср. отклик, мс (0=выкл)</label>
              <input
                type="number"
                value={autostop.avg_response_ms}
                onChange={(e) => setAutostop({ avg_response_ms: Number(e.target.value) })}
              />
            </div>
            <div className="field" style={{ width: 130, flex: "none" }}>
              <label>...в течение, с</label>
              <input
                type="number"
                value={autostop.avg_response_sec}
                onChange={(e) => setAutostop({ avg_response_sec: Number(e.target.value) })}
              />
            </div>
          </>
        )}
      </div>

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
              Запуск: <code>k6 run {done.endsWith(".zip") ? "script.js" : done}</code>. Нужен
              доступ в интернет для jslib-импортов (k6-utils
              {done.endsWith(".zip") ? ", papaparse" : ""}).
            </>
          ) : (
            <>
              Требуются плагины JMeter <code>jpgc-casutg</code> и <code>jpgc-tst</code>.
            </>
          )}
        </div>
      )}

      {savedHint && (
        <div className="hint" style={{ marginTop: 12 }}>
          {savedHint}
        </div>
      )}

      <h3 style={{ fontSize: 13, marginTop: 18 }}>Движок и сборка</h3>

      <BuildHistory refreshKey={historyKey} onRestore={onRestoreScenario} />

      <div className="inline" style={{ marginBottom: 12 }}>
        <div
          className={`pill-source ${engine === "jmeter" ? "active" : ""}`}
          onClick={() => setEngine("jmeter")}
        >
          JMeter (.jmx)
        </div>
        <div
          className={`pill-source ${engine === "k6" ? "active" : ""}`}
          onClick={() => setEngine("k6")}
        >
          k6 (.js)
        </div>
      </div>
      <div className="hint" style={{ marginTop: -6 }}>
        {engine === "k6"
          ? "k6: каждая группа — scenario с ramping-arrival-rate (по RPS); корреляция, датасеты (SharedArray), checks и AutoStop→thresholds переносятся автоматически."
          : "JMeter: Concurrency Thread Group + Throughput Shaping Timer на каждую группу."}
      </div>

      {readiness.blockers > 0 && (
        <div className="error" style={{ marginTop: 12 }}>
          Сборка заблокирована: {readiness.blockers} критических замечаний в «Пульсе сценария» выше.
          Раскройте панель и перейдите к проблемным шагам.
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
            disabled={building || saving || groups.length === 0 || readiness.blockers > 0}
            title="Сохранить сборку и скачать сохранённый артефакт"
          >
            {building ? "Собираем…" : "Выгрузить скрипт"}
          </button>
          <button
            className="ghost"
            onClick={saveOnly}
            disabled={building || saving || groups.length === 0 || readiness.blockers > 0}
          >
            {saving ? "…" : "Сохранить сборку"}
          </button>
          <button
            className="success"
            onClick={goToRun}
            disabled={building || saving || groups.length === 0 || readiness.blockers > 0 || !onGoToRun}
            title={
              readiness.blockers > 0
                ? `Исправьте ${readiness.blockers} блокер(ов) в «Пульсе сценария»`
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
