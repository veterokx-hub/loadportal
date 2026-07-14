"use client";

import { useState } from "react";
import { analyze } from "@/lib/api";
import type { Scenario, SourceType } from "@/lib/types";

export function Step1Source({
  onAnalyzed,
}: {
  onAnalyzed: (s: Scenario) => void;
}) {
  const [sourceType, setSourceType] = useState<SourceType>("openapi");
  const [mode, setMode] = useState<"url" | "content">("url");
  const [url, setUrl] = useState("");
  const [content, setContent] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Postman-коллекция принимается только как JSON-содержимое (без URL).
  const inputMode = sourceType === "postman" ? "content" : mode;

  async function run() {
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

  const canRun = inputMode === "url" ? url.trim().length > 0 : content.trim().length > 0;

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
        </div>
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

      {inputMode === "url" ? (
        <div className="field">
          <label>URL Swagger/OpenAPI</label>
          <input
            placeholder="https://example.com/v3/api-docs или .../swagger.json"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <div className="hint">
            Поддерживаются прямые ссылки на JSON/YAML спецификацию (напр.{" "}
            <code>.../swagger.json</code>, <code>.../v3/api-docs</code>), а также страница
            Swagger UI — портал попробует найти спеку автоматически (springdoc/springfox).
          </div>
        </div>
      ) : (
        <div className="field">
          <label>
            {sourceType === "postman"
              ? "JSON Postman-коллекции"
              : "Содержимое спецификации (JSON/YAML)"}
          </label>
          <textarea
            placeholder={
              sourceType === "postman"
                ? "Вставьте JSON экспортированной Postman-коллекции..."
                : "Вставьте JSON/YAML спецификации..."
            }
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>
      )}

      <div className="field">
        <label>Название сценария (необязательно)</label>
        <input
          placeholder="Возьмётся из спецификации, если не указано"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      {error && <div className="error">Ошибка анализа: {error}</div>}

      <div className="footer-nav">
        <span />
        <button onClick={run} disabled={!canRun || loading}>
          {loading ? "Анализируем..." : "Анализировать →"}
        </button>
      </div>
    </div>
  );
}
