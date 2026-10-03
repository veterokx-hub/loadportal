"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Scenario } from "@/lib/types";
import type { BuildHistoryItem, ScriptSummary } from "@/lib/api";
import {
  createRun,
  getGitLabRunDefaults,
  listBuilds,
  listScripts,
  loadBuildScenario,
  uploadScript,
} from "@/lib/api";
import { groupIntensity, groupRequests } from "@/lib/grouping";
import { totalDuration } from "@/lib/profile";
import { ENGINES, type Engine } from "@/lib/engines";
import { FileUploadButton } from "@/components/FileUploadButton";

type SourceMode = "build" | "upload";

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error("Некорректная дата");
  }
  return d.toISOString();
}

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
  const [startLocal, setStartLocal] = useState(() => toLocalInputValue(new Date()));
  const [endLocal, setEndLocal] = useState("");
  const [endTouched, setEndTouched] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [cluster, setCluster] = useState("");
  const [namespace, setNamespace] = useState("");
  const [service, setService] = useState("");
  const [container, setContainer] = useState("");
  const [cpu, setCpu] = useState("2");
  const [memory, setMemory] = useState("4Gi");
  const [repository, setRepository] = useState("lt-ump");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadEngine, setUploadEngine] = useState<Engine>("jmeter");
  const [error, setError] = useState<string | null>(null);

  const selectedBuild = useMemo(
    () => builds.find((b) => b.id === buildId) ?? null,
    [builds, buildId]
  );

  const selectedScript = useMemo(
    () => scripts.find((s) => s.id === scriptId) ?? null,
    [scripts, scriptId]
  );

  const engine =
    (selectedBuild?.engine as Engine | undefined) ??
    (selectedScript?.engine as Engine | undefined) ??
    "jmeter";

  const filename =
    sourceMode === "build"
      ? selectedBuild?.filename ?? "scenario.jmx"
      : selectedScript?.filename ?? "script";

  const scenarioPath = testId.trim()
    ? `scenarios/${testId.trim()}/{run_id}/${filename}`
    : `scenarios/{jira}/{run_id}/${filename}`;

  const durationSec = useMemo(() => {
    if (!scenarioPreview) return 300;
    const groups = groupRequests(scenarioPreview);
    if (groups.length === 0) return 300;
    return groups.reduce(
      (max, g) => Math.max(max, totalDuration(groupIntensity(g), scenarioPreview.load)),
      0
    );
  }, [scenarioPreview]);

  useEffect(() => {
    if (endTouched) return;
    const start = new Date(startLocal);
    if (Number.isNaN(start.getTime())) return;
    const end = new Date(start.getTime() + durationSec * 1000);
    setEndLocal(toLocalInputValue(end));
  }, [startLocal, durationSec, endTouched]);

  const loadSources = useCallback(async () => {
    try {
      const [b, s, defaults] = await Promise.all([
        listBuilds(),
        listScripts(),
        getGitLabRunDefaults().catch(() => ({ gitlab_repository: "lt-ump", configured: false })),
      ]);
      setBuilds(b);
      setScripts(s);
      setRepository(defaults.gitlab_repository || "lt-ump");
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
    if (!buildId || sourceMode !== "build") {
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
  }, [buildId, scenario, sourceMode]);

  async function onUpload(file: File | null) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded = await uploadScript(file, uploadEngine);
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
      const run = await createRun({
        test_id: testId.trim(),
        build_id: sourceMode === "build" ? buildId || undefined : undefined,
        script_id: sourceMode === "upload" ? scriptId || undefined : undefined,
        scenario_name: selectedBuild?.scenario_name ?? scenarioPreview?.name,
        engine,
        target_url: scenarioPreview?.base_url,
        start_time: localInputToIso(startLocal),
        end_time: localInputToIso(endLocal),
        cpu: cpu.trim() || "2",
        memory: memory.trim() || "4Gi",
        // scenario_path считает backend: scenarios/{jira}/{portal_run_id}/{filename}
        pod_name: filename,
        repository,
        target_cluster: cluster.trim(),
        target_namespace: namespace.trim(),
        target_service: service.trim(),
        target_container: container.trim(),
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
    Boolean(startLocal) &&
    Boolean(endLocal) &&
    ((sourceMode === "build" && Boolean(buildId)) ||
      (sourceMode === "upload" && Boolean(scriptId)));

  return (
    <form onSubmit={submit} className="run-form">
      <div className="field">
        <label>Задача в Jira</label>
        <input
          value={testId}
          onChange={(e) => setTestId(e.target.value)}
          placeholder="NT-1234"
          required
          autoComplete="off"
        />
        <div className="hint">Ключ задачи → переменная RUN_ID.</div>
      </div>

      <div className="field">
        <label>Источник скрипта</label>
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
            <label>Файл (.jmx, .js или .zip)</label>
            <div className="inline" style={{ gap: 10, alignItems: "center" }}>
              <select
                value={uploadEngine}
                style={{ width: 150 }}
                onChange={(e) => setUploadEngine(e.target.value as Engine)}
              >
                {ENGINES.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.short}
                  </option>
                ))}
              </select>
              <FileUploadButton
                accept=".jmx,.js,.ts,.zip,application/zip,application/javascript,text/javascript"
                disabled={uploading}
                onPick={(file) => void onUpload(file)}
              />
              {selectedScript && <span className="hint">{selectedScript.filename}</span>}
            </div>
            <div className="hint">
              Движок уходит в <code>TOOL</code> пайплайна: по расширению .zip его не угадать
              (JMeter+CSV, k6+CSV, Maven-проект Gatling). ZIP кладётся в S3
              распакованным, в ту же папку ключа.
            </div>
            {uploading && <div className="hint">Загрузка…</div>}
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

      <div className="row">
        <div className="field">
          <label>Старт</label>
          <input
            type="datetime-local"
            value={startLocal}
            onChange={(e) => setStartLocal(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label>Окончание</label>
          <input
            type="datetime-local"
            value={endLocal}
            onChange={(e) => {
              setEndTouched(true);
              setEndLocal(e.target.value);
            }}
            required
          />
          <div className="hint">
            По умолчанию из длительности сценария (~{durationSec} с), можно изменить.
          </div>
        </div>
      </div>

      <div className="field">
        <label>Тестируемый сервис в кластере</label>
        <div className="row">
          <div className="field" style={{ marginBottom: 0 }}>
            <input
              value={cluster}
              onChange={(e) => setCluster(e.target.value)}
              placeholder="кластер"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <input
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
              placeholder="namespace"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <input
              value={service}
              onChange={(e) => setService(e.target.value)}
              placeholder="сервис"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <input
              value={container}
              onChange={(e) => setContainer(e.target.value)}
              placeholder="контейнер"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>
        <div className="hint">
          Не обязательно для запуска, но без этих полей модуль «Анализ» не найдёт метрики:
          из URL стенда не видно, какие поды за ним стоят. Заполнено — отчёт соберётся
          автоматически, как только тест закончится.
        </div>
      </div>

      <details
        open={advancedOpen}
        onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
        style={{ margin: "8px 0 16px" }}
      >
        <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
          Дополнительно (CPU / Memory)
        </summary>
        <div className="row" style={{ marginTop: 12 }}>
          <div className="field">
            <label>CPU</label>
            <input value={cpu} onChange={(e) => setCpu(e.target.value)} placeholder="2" />
          </div>
          <div className="field">
            <label>Memory</label>
            <input value={memory} onChange={(e) => setMemory(e.target.value)} placeholder="4Gi" />
          </div>
        </div>
        <div className="hint">REPLICAS всегда 1. Память JVM задаётся в образе пайплайна.</div>
      </details>

      <div className="field">
        <label>Сводка</label>
        <div className="hint" style={{ display: "grid", gap: 4 }}>
          <div>
            TOOL: <code>{engine}</code>
          </div>
          <div>
            SCENARIO_PATH: <code>{scenarioPath}</code>
          </div>
          <div>
            REPOSITORY: <code>{repository}</code>
          </div>
          <div>
            ref: <code>master</code>
          </div>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="footer-nav" style={{ marginTop: 8 }}>
        <span />
        <button type="submit" className="success" disabled={loading || !ready}>
          {loading ? "Запускаем…" : "Запустить тест"}
        </button>
      </div>
    </form>
  );
}
