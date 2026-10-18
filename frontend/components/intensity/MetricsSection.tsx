"use client";

import type { ReactNode } from "react";
import type { PrometheusConfig } from "@/lib/types";
import type { Engine } from "@/lib/engines";
import { FormSection } from "@/components/intensity/FormSection";

/**
 * Выгрузка метрик — у каждого движка своя. Поля показываются только там,
 * где они реально попадают в артефакт.
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
  if (engine === "gatling") {
    return (
      <FormSection
        title="Метрики"
        aside={<span className="tag">отчёт Gatling</span>}
        lead={
          <>
            HTML-отчёт собирается в <code>target/gatling/</code>, в VictoriaMetrics Gatling не пишет.
          </>
        }
        details={[
          <>
            <code>runId</code> и имя сценария попадают в <code>runDescription</code> файла{" "}
            <code>gatling.conf</code> — так прогон подписан в отчёте.
          </>,
        ]}
      >
        <div className="compact-grid">
          <div className="field span-2">
            <label htmlFor="prom-run-id">runId</label>
            <input
              id="prom-run-id"
              value={prom.run_id}
              onChange={(e) => setPrometheus({ run_id: e.target.value })}
            />
          </div>
        </div>
      </FormSection>
    );
  }

  const jmeter = engine === "jmeter";
  const url = prom.influxdb_url.trim();
  const urlWarn = jmeter && /[,}]/.test(url) ? "Запятая и «}» в адресе ломают свойство JMeter" : null;

  const details: ReactNode[] = jmeter
    ? [
        <>
          В .jmx добавляется <code>InfluxdbBackendListenerClient</code>: Influx line protocol на{" "}
          <code>/write</code>, отдельный jar не нужен.
        </>,
        <>
          Токен уходит заголовком <code>Authorization: Token</code>. Тег <code>runId</code> приходит из{" "}
          <code>-JrunId</code>.
        </>,
        <>
          Раннер может подменить адрес свойством <code>influxdb_url</code>.
        </>,
      ]
    : [
        <>
          В архив кладётся <code>vm.json</code>, раннер запускает k6 с{" "}
          <code>-o experimental-prometheus-rw</code>. Адрес <code>/write</code> заменяется на{" "}
          <code>/api/v1/write</code>.
        </>,
        <>
          Токен уходит заголовком <code>Authorization: Bearer</code> и в скрипт не пишется.
        </>,
        <>
          Теги <code>application</code>, <code>measurement</code>, <code>runId</code> ставятся на каждую
          серию; <code>runId</code> перекрывает <code>LT_RUN_ID</code>, адрес — <code>LT_INFLUX_URL</code>{" "}
          или <code>K6_PROMETHEUS_RW_SERVER_URL</code>.
        </>,
      ];

  return (
    <FormSection
      title="Метрики"
      aside={<span className="tag">VictoriaMetrics</span>}
      lead={
        jmeter
          ? "JMeter шлёт метрики через Influx line protocol."
          : "k6 шлёт метрики через Prometheus remote write."
      }
      details={details}
    >
      <div className="compact-grid">
        <div className="field mono span-8">
          <label htmlFor="prom-url">Адрес записи</label>
          <input
            id="prom-url"
            value={prom.influxdb_url}
            placeholder="http://victoriametrics:8428/write?db=jmeter"
            aria-invalid={urlWarn ? true : undefined}
            onChange={(e) => setPrometheus({ influxdb_url: e.target.value })}
          />
          {urlWarn && <span className="field-warn">{urlWarn}</span>}
        </div>
        <div className="field span-4">
          <label htmlFor="prom-token">Токен</label>
          <input
            id="prom-token"
            type="password"
            autoComplete="off"
            value={prom.influxdb_token}
            placeholder="без авторизации"
            onChange={(e) => setPrometheus({ influxdb_token: e.target.value })}
          />
        </div>

        <div className={`field ${jmeter ? "span-3" : "span-4"}`}>
          <label htmlFor="prom-app" title="Тег application на каждой точке">
            application
          </label>
          <input
            id="prom-app"
            value={prom.application}
            placeholder={scenarioName || "имя сценария"}
            onChange={(e) => setPrometheus({ application: e.target.value })}
          />
        </div>
        <div className={`field ${jmeter ? "span-3" : "span-4"}`}>
          <label htmlFor="prom-measurement">measurement</label>
          <input
            id="prom-measurement"
            value={prom.measurement}
            placeholder="jmeter"
            onChange={(e) => setPrometheus({ measurement: e.target.value })}
          />
        </div>
        <div className={`field mono ${jmeter ? "span-3" : "span-4"}`}>
          <label htmlFor="prom-percentiles" title="Через точку с запятой">
            percentiles
          </label>
          <input
            id="prom-percentiles"
            value={prom.percentiles}
            placeholder="99;95;90"
            onChange={(e) => setPrometheus({ percentiles: e.target.value })}
          />
        </div>
        {jmeter && (
          <div className="field mono span-3">
            <label htmlFor="prom-samplers" title="Какие сэмплеры отправлять">
              samplersRegex
            </label>
            <input
              id="prom-samplers"
              value={prom.samplers_reg_exp}
              placeholder=".*"
              onChange={(e) => setPrometheus({ samplers_reg_exp: e.target.value })}
            />
          </div>
        )}
        {jmeter && (
          <div className="field span-12">
            <label className="check-inline">
              <input
                type="checkbox"
                checked={prom.summary_only}
                onChange={(e) => setPrometheus({ summary_only: e.target.checked })}
              />
              Только сводка
              <span className="muted">— без метрик по каждому запросу</span>
            </label>
          </div>
        )}
      </div>
    </FormSection>
  );
}
