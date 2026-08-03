"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Scenario } from "@/lib/types";
import type { BuildHistoryItem, ScriptSummary } from "@/lib/api";
import { createRun, listBuilds, listScripts, loadBuildScenario, uploadScript } from "@/lib/api";

type SourceMode = "build" | "upload";

export function NewRunForm({
  scenario,
  initialBuildId,
  onCreated,
}: {
  scenario: Scenario | null;
  initialBuildId?: string | null;
  onCreated: (runId: string) => void;
}) {
  const [sourceMode, setSourceMode] = useState<SourceMode>("build");
  const [builds, setBuilds] = useState<BuildHistoryItem[]>([]);
  const [scripts, setScripts] = useState<ScriptSummary[]>([]);
  const [buildId, setBuildId] = useState(initialBuildId ?? "");
  const [scriptId, setScriptId] = useState("");
  const [scenarioPreview, setScenarioPreview] = useState<Scenario | null>(scenario);
  const [testId, setTestId] = useState("");
  const [heapMb, setHeapMb] = useState(1024);
  const [gitUrl, setGitUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedBuild = useMemo(
    () => builds.find((b) => b.id === buildId) ?? null,
    [builds, buildId]
  );

  const engine =
    (selectedBuild?.engine as "jmeter" | "k6" | undefined) ??
    (scripts.find((s) => s.id === scriptId)?.engine as "jmeter" | "k6" | undefined) ??
    "jmeter";

  const loadSources = useCallback(async () => {
    try {
      const [b, s] = await Promise.all([listBuilds(), listScripts()]);
      setBuilds(b);
      setScripts(s);
      const preferred =
        initialBuildId && b.some((x) => x.id === initialBuildId)
          ? initialBuildId
          : b[0]?.id ?? "";
      if (preferred) setBuildId(preferred);
    } catch {
      /* пусто */
    }
  }, [initialBuildId]);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

  useEffect(() => {
    if (!buildId) {
      setScenarioPreview(scenario);
      return;
    }
    let cancelled = false;
    loadBuildScenario(buildId)
      .then((s) => {
        if (!cancelled) setScenarioPreview(s);
      })
      .catch(() => {
        if (!cancelled) setScenarioPreview(scenario);
      });
    return () => {
      cancelled = true;
    };
  }, [buildId, scenario]);

  async function onUpload(file: File | null) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded = await uploadScript(file, undefined, gitUrl.trim() || undefined);
      setScripts(await listScripts());
      setScriptId(uploaded.id);
      setSourceMode("upload");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const params: Record<string, unknown> =
        engine === "jmeter" ? { heap_mb: heapMb } : {};
      const run = await createRun({
        test_id: testId.trim(),
        build_id: sourceMode === "build" ? buildId || undefined : undefined,
        script_id: sourceMode === "upload" ? scriptId || undefined : undefined,
        scenario_name: selectedBuild?.scenario_name ?? scenarioPreview?.name,
        engine,
        target_url: scenarioPreview?.base_url,
        params,
      });
      if (run.status === "failed" && run.error_message) {
        setError(run.error_message);
      }
      onCreated(run.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const ready =
    Boolean(testId.trim()) &&
    ((sourceMode === "build" && Boolean(buildId)) ||
      (sourceMode === "upload" && Boolean(scriptId)));

  const scenarioName = selectedBuild?.scenario_name ?? scenarioPreview?.name ?? "—";
  const targetUrl = scenarioPreview?.base_url || "—";

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label>Задача в Jira</label>
        <input
          value={testId}
          onChange={(e) => setTestId(e.target.value)}
          placeholder="NT-1234"
          required
          autoComplete="off"
        />
        <div className="hint">Ключ задачи для отчётов и трассировки прогона.</div>
      </div>

      <div className="field">
        <label>Скрипт</label>
        <div className="inline">
          <div
            className={`pill-source ${sourceMode === "build" ? "active" : ""}`}
            onClick={() => setSourceMode("build")}
          >
            Из сборки
          </div>
          <div
            className={`pill-source ${sourceMode === "upload" ? "active" : ""}`}
            onClick={() => setSourceMode("upload")}
          >
            Загрузить файл
          </div>
        </div>
      </div>

      {sourceMode === "build" && (
        <div className="field">
          {builds.length === 0 ? (
            <div className="hint">
              Сборок пока нет — сохраните сценарий в разделе «Сценарий» или загрузите файл.
            </div>
          ) : (
            <>
              <label>Сборка</label>
              <select value={buildId} onChange={(e) => setBuildId(e.target.value)}>
                {builds.map((b) => (
                  <option key={b.id} value={b.id}>
                    {new Date(b.created_at).toLocaleString("ru-RU")} · {b.scenario_name} ·{" "}
                    {b.engine}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      )}

      {sourceMode === "upload" && (
        <>
          <div className="field">
            <label>Файл (.jmx или .js)</label>
            <input
              type="file"
              accept=".jmx,.js,.ts,application/javascript,text/javascript"
              disabled={uploading}
              onChange={(e) => onUpload(e.target.files?.[0] ?? null)}
            />
            {uploading && <div className="hint">Загрузка…</div>}
          </div>
          <div className="field">
            <label>Ссылка в Git (необязательно)</label>
            <input
              value={gitUrl}
              onChange={(e) => setGitUrl(e.target.value)}
              placeholder="https://gitlab…/script.jmx"
            />
          </div>
          {scripts.length > 0 && (
            <div className="field">
              <label>Ранее загруженные</label>
              <select value={scriptId} onChange={(e) => setScriptId(e.target.value)}>
                <option value="">Выберите скрипт…</option>
                {scripts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.filename} · {s.engine}
                  </option>
                ))}
              </select>
            </div>
          )}
        </>
      )}

      <h3 style={{ fontSize: 13, marginTop: 8 }}>Параметры сценария</h3>
      <div className="row">
        <div className="field">
          <label>Движок</label>
          <div>
            <span className="tag">{engine}</span>
          </div>
        </div>
        <div className="field">
          <label>Сценарий</label>
          <div>{scenarioName}</div>
        </div>
      </div>
      <div className="field">
        <label>Target URL</label>
        <code style={{ wordBreak: "break-all", fontSize: 13 }}>{targetUrl}</code>
        <div className="hint">Берётся из сценария, менять здесь не нужно.</div>
      </div>

      {engine === "jmeter" && (
        <div className="field" style={{ maxWidth: 240 }}>
          <label>Память JVM, МБ</label>
          <input
            type="number"
            min={256}
            step={256}
            value={heapMb}
            onChange={(e) => setHeapMb(Number(e.target.value))}
          />
          <div className="hint">Heap для инстанса JMeter (-Xmx).</div>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      <div className="footer-nav" style={{ marginTop: 8 }}>
        <span />
        <button type="submit" className="success" disabled={loading || !ready}>
          {loading ? "Создаём…" : "Создать прогон →"}
        </button>
      </div>
    </form>
  );
}
