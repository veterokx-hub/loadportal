"use client";

import { useState } from "react";
import { analyze } from "@/lib/api";
import type { Scenario, SourceType } from "@/lib/types";
import { BuildHistory } from "@/components/BuildHistory";
import { FileUploadButton } from "@/components/FileUploadButton";

/** Пустой сценарий для сборки «с чистого листа» — без спецификации. */
function blankScenario(name: string): Scenario {
  return {
    name: name.trim() || "Новый сценарий",
    source_type: "openapi",
    base_url: "",
    load: { test_mode: "ramp_hold", steps: 5, step_duration_sec: 60, assumed_latency_sec: 1.0 },
    datasets: [],
    autostop: {
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
    },
    requests: [],
  };
}

export function Step1Source({
  onAnalyzed,
  onRestore,
  currentScenario,
}: {
  onAnalyzed: (s: Scenario) => void;
  /** Подтянуть сохранённую сборку (полная замена текущего сценария). */
  onRestore?: (s: Scenario) => void;
  currentScenario?: Scenario | null;
}) {
  const [sourceType, setSourceType] = useState<SourceType | "blank">("openapi");
  const [mode, setMode] = useState<"url" | "content">("url");
  const [url, setUrl] = useState("");
  const [content, setContent] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const isBlank = sourceType === "blank";
  // Postman-коллекция — файл или JSON, без URL.
  const inputMode = sourceType === "postman" ? "content" : mode;

  async function run() {
    if (isBlank) {
      onAnalyzed(blankScenario(name));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const scenario = await analyze({
        source_type: sourceType,
        url: inputMode === "url" ? url.trim() : undefined,
        content: inputMode === "content" ? content : undefined,
        name: name.trim() || undefined,
      });
      onAnalyzed(scenario);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const canRun =
    isBlank || (inputMode === "url" ? url.trim().length > 0 : content.trim().length > 0);

  function onPickFile(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setContent(typeof reader.result === "string" ? reader.result : "");
      setFileName(file.name);
      setError(null);
    };
    reader.onerror = () => setError("Не удалось прочитать файл");
    reader.readAsText(file);
  }

  return (
    <div className="panel">
      <h2>1. Источник спецификации</h2>

      <div className="field">
        <label>Тип источника</label>
        <div className="inline">
          <div
            className={`pill-source ${sourceType === "openapi" ? "active" : ""}`}
            onClick={() => setSourceType("openapi")}
          >
            Swagger / OpenAPI
          </div>
          <div
            className={`pill-source ${sourceType === "postman" ? "active" : ""}`}
            onClick={() => setSourceType("postman")}
          >
            Postman Collection
          </div>
          <div
            className={`pill-source ${isBlank ? "active" : ""}`}
            onClick={() => setSourceType("blank")}
          >
            С чистого листа
          </div>
        </div>
        {isBlank && (
          <div className="hint">
            Сценарий создаётся без спецификации — запросы добавите вручную на шаге «Запросы».
          </div>
        )}
      </div>

      {sourceType === "openapi" && (
        <div className="field">
          <label>Способ ввода</label>
          <div className="inline">
            <div
              className={`pill-source ${mode === "url" ? "active" : ""}`}
              onClick={() => setMode("url")}
            >
              По URL
            </div>
            <div
              className={`pill-source ${mode === "content" ? "active" : ""}`}
              onClick={() => setMode("content")}
            >
              Вставить содержимое
            </div>
          </div>
        </div>
      )}

      {isBlank ? null : inputMode === "url" ? (
        <div className="field">
          <label>URL Swagger/OpenAPI</label>
          <input
            placeholder="https://example.com/v3/api-docs или .../swagger.json"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <div className="hint">
            JSON/YAML спека (<code>swagger.json</code>, <code>v3/api-docs</code>) или страница
            Swagger UI — портал найдёт спецификацию сам.
          </div>
        </div>
      ) : (
        <div className="field">
          <label>
            {sourceType === "postman"
              ? "JSON Postman-коллекции"
              : "Содержимое спецификации (JSON/YAML)"}
          </label>
          <div className="inline" style={{ marginBottom: 10, gap: 10, alignItems: "center" }}>
            <FileUploadButton
              accept={
                sourceType === "postman"
                  ? ".json,application/json"
                  : ".json,.yaml,.yml,application/json,text/yaml,text/plain"
              }
              onPick={onPickFile}
            />
            {fileName && <span className="hint">{fileName}</span>}
          </div>
          <textarea
            placeholder={
              sourceType === "postman"
                ? "Вставьте JSON экспортированной Postman-коллекции или загрузите файл…"
                : "Вставьте JSON/YAML спецификации..."
            }
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setFileName(null);
            }}
          />
        </div>
      )}

      <div className="field">
        <label>Название сценария (необязательно)</label>
        <input
          placeholder={
            isBlank ? "Новый сценарий" : "Возьмётся из спецификации, если не указано"
          }
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      {error && <div className="error">Ошибка анализа: {error}</div>}

      <div className="footer-nav">
        <span />
        <button onClick={run} disabled={!canRun || loading}>
          {isBlank
            ? "Создать пустой сценарий →"
            : loading
              ? "Анализируем..."
              : "Анализировать →"}
        </button>
      </div>

      {onRestore && (
        <BuildHistory
          onRestore={onRestore}
          currentScenario={currentScenario}
        />
      )}
    </div>
  );
}
