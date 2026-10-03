"use client";

import type { PrometheusConfig } from "@/lib/types";
import type { Engine } from "@/lib/engines";

/**
 * Выгрузка метрик — у каждого движка своя. Блоки намеренно не объединены:
 * поля показываются только там, где они реально попадают в артефакт.
 */
export function MetricsSection({
  engine,
  scenarioName,
  prom,
  setPrometheus,
}: {
  engine: Engine;
  scenarioName: string;
  prom: PrometheusConfig;
  setPrometheus: (patch: Partial<PrometheusConfig>) => void;
}) {
  if (engine === "jmeter") {
    return (
      <>
        <h3 style={{ fontSize: 13, marginTop: 18 }}>Метрики · VictoriaMetrics</h3>
        <p className="muted" style={{ marginTop: -6 }}>
          В каждый .jmx ставится штатный{" "}
          <code>InfluxdbBackendListenerClient</code>. Он шлёт Influx line protocol на{" "}
          <code>/write</code> VictoriaMetrics. Отдельный jar не нужен.
        </p>
        <div className="field">
          <label>Адрес VictoriaMetrics</label>
          <input
            value={prom.influxdb_url}
            placeholder="http://victoriametrics:8428/write?db=jmeter"
            onChange={(e) => setPrometheus({ influxdb_url: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Токен</label>
          <input
            type="password"
            autoComplete="off"
            value={prom.influxdb_token}
            placeholder="пусто, если авторизация не нужна"
            onChange={(e) => setPrometheus({ influxdb_token: e.target.value })}
          />
        </div>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field">
            <label>application</label>
            <input
              value={prom.application}
              placeholder={scenarioName || "имя сценария"}
              onChange={(e) => setPrometheus({ application: e.target.value })}
            />
          </div>
          <div className="field" style={{ width: 160, flex: "none" }}>
            <label>measurement</label>
            <input
              value={prom.measurement}
              placeholder="jmeter"
              onChange={(e) => setPrometheus({ measurement: e.target.value })}
            />
          </div>
        </div>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field">
            <label>samplersRegex</label>
            <input
              value={prom.samplers_reg_exp}
              placeholder=".*"
              onChange={(e) => setPrometheus({ samplers_reg_exp: e.target.value })}
            />
          </div>
          <div className="field" style={{ width: 180, flex: "none" }}>
            <label>percentiles</label>
            <input
              value={prom.percentiles}
              placeholder="99;95;90"
              onChange={(e) => setPrometheus({ percentiles: e.target.value })}
            />
          </div>
        </div>
        <label className="inline" style={{ textTransform: "none", marginBottom: 8 }}>
          <input
            type="checkbox"
            style={{ width: "auto" }}
            checked={prom.summary_only}
            onChange={(e) => setPrometheus({ summary_only: e.target.checked })}
          />
          <span>Только сводка, без метрик по каждому запросу</span>
        </label>
        <div className="hint">
          Раннер может подменить адрес свойством <code>influxdb_url</code>. В адресе не должно
          быть запятой и <code>{"}"}</code>: JMeter режет значение по умолчанию у{" "}
          <code>__P</code> по запятой. Метка прогона <code>runId</code> приходит как{" "}
          <code>-JrunId</code> и пишется тегом на каждую точку. Токен уходит заголовком{" "}
          <code>Authorization: Token …</code>.
        </div>
      </>
    );
  }

  if (engine === "k6") {
    return (
      <>
        <h3 style={{ fontSize: 13, marginTop: 18 }}>Метрики · встроенные k6</h3>
        <p className="muted" style={{ marginTop: -6 }}>
          Скрипт пишет стандартные метрики k6 и <code>portal_errors</code> (провал валидации
          или сетевой сбой). Вывод задаётся флагами запуска (<code>--out</code>).
        </p>
      </>
    );
  }

  return (
    <>
      <h3 style={{ fontSize: 13, marginTop: 18 }}>Метрики · отчёт Gatling</h3>
      <p className="muted" style={{ marginTop: -6 }}>
        Прогон пишет <code>console</code> и <code>simulation.log</code>, HTML-отчёт
        собирается в <code>target/gatling/</code>.
      </p>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="field" style={{ width: 100, flex: "none" }}>
          <label>runId</label>
          <input value={prom.run_id} onChange={(e) => setPrometheus({ run_id: e.target.value })} />
        </div>
      </div>
      <div className="hint">
        runId и имя сценария уходят в <code>runDescription</code> внутри{" "}
        <code>src/test/resources/gatling.conf</code> — так прогон подписан в отчёте.
      </div>
    </>
  );
}
