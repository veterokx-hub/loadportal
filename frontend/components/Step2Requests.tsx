"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RequestModel, Scenario } from "@/lib/types";
import { healthMark, revealHealth, useHealthFocus } from "@/lib/health-focus";
import { paramsFromTemplates, urlTemplate } from "@/lib/request-params";
import { duplicateRequestName } from "@/lib/request-copy";
import { stripHidden } from "@/lib/paste";

const METHOD_PRESETS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

function methodOptions(requests: RequestModel[]): string[] {
  const all = new Set(METHOD_PRESETS);
  requests.forEach((r) => {
    if (r.method) all.add(r.method.toUpperCase());
  });
  return Array.from(all);
}

export function Step2Requests({
  scenario,
  setScenario,
  onBack,
  onNext,
}: {
  scenario: Scenario;
  setScenario: (s: Scenario) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const requests = [...scenario.requests].sort((a, b) => a.order - b.order);
  const methods = useMemo(() => methodOptions(requests), [requests]);
  const [newMethod, setNewMethod] = useState("GET");
  const [newPath, setNewPath] = useState("/");
  const [newName, setNewName] = useState("");
  const scenarioRef = useRef(scenario);
  scenarioRef.current = scenario;
  const health = useHealthFocus();
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);

  useEffect(() => {
    if (!health || health.step !== 1) return;
    const timer = window.setTimeout(() => revealHealth(health), 50);
    return () => window.clearTimeout(timer);
  }, [health]);
  const paramTimers = useRef<Record<string, number>>({});

  function syncParams(id: string, address?: { path?: string; url?: string | null }) {
    const r = scenarioRef.current.requests.find((x) => x.id === id);
    if (!r) return;
    const merged = address ? { ...r, ...address } : r;
    const next = paramsFromTemplates(
      urlTemplate(merged),
      merged.body?.content ?? "",
      r.params
    );
    patch(id, { ...address, params: next });
  }

  function scheduleParamSync(id: string) {
    window.clearTimeout(paramTimers.current[id]);
    paramTimers.current[id] = window.setTimeout(() => syncParams(id), 450);
  }

  function flushParamSync(id: string, address?: { path?: string; url?: string | null }) {
    window.clearTimeout(paramTimers.current[id]);
    syncParams(id, address);
  }

  function list(): RequestModel[] {
    return [...scenarioRef.current.requests].sort((a, b) => a.order - b.order);
  }

  function commit(nextRequests: RequestModel[]) {
    const next = { ...scenarioRef.current, requests: nextRequests };
    scenarioRef.current = next;
    setScenario(next);
  }

  function addRequest() {
    const path = newPath.trim() || "/";
    const method = newMethod.trim().toUpperCase() || "GET";
    const current = list();
    const req: RequestModel = {
      id: `custom_${Date.now().toString(36)}`,
      order: current.length + 1,
      name: newName.trim() || `${method} ${path}`,
      method,
      path,
      headers: [],
      query_params: [],
      body: { mode: "none", content_type: null, content: "" },
      params: paramsFromTemplates(path, "", []),
      extractions: [],
      intensity: { target_rps: 10, ramp_up_sec: 30, hold_sec: 60 },
      validation: { check_response_code: true, expected_status: 200, response_contains: "" },
      dataset_id: null,
      repeat: 1,
      throughput: 100,
    };
    commit([...current, req]);
    setNewName("");
    setNewPath("/");
  }

  function remove(id: string) {
    commit(list().filter((r) => r.id !== id).map((r, i) => ({ ...r, order: i + 1 })));
  }

  function duplicate(id: string) {
    const current = list();
    const idx = current.findIndex((r) => r.id === id);
    if (idx < 0) return;
    const src = current[idx];
    const copy: RequestModel = {
      ...structuredClone(src),
      id: `custom_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: duplicateRequestName(src.name, current.map((r) => r.name)),
    };
    const next = [...current.slice(0, idx + 1), copy, ...current.slice(idx + 1)].map((r, i) => ({
      ...r,
      order: i + 1,
    }));
    commit(next);
  }

  function move(fromId: string, toId: string) {
    if (!fromId || fromId === toId) return;
    const current = list();
    const from = current.findIndex((r) => r.id === fromId);
    const to = current.findIndex((r) => r.id === toId);
    if (from < 0 || to < 0) return;
    const next = [...current];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    commit(next.map((r, i) => ({ ...r, order: i + 1 })));
  }

  function patch(id: string, p: Partial<RequestModel>) {
    // setScenario подменяет объект целиком. Таймер параметров иначе пишет
    // сценарий прошлого рендера и стирает путь, набранный после него.
    const current = scenarioRef.current;
    const next = {
      ...current,
      requests: current.requests.map((r) => (r.id === id ? { ...r, ...p } : r)),
    };
    scenarioRef.current = next;
    setScenario(next);
  }

  return (
    <div className="panel">
      <h2>2. Запросы</h2>
      <div className="field" data-health={healthMark("base-url")}>
        <label>Базовый URL</label>
        <input
          value={scenario.base_url}
          onChange={(e) => setScenario({ ...scenario, base_url: e.target.value })}
          placeholder="https://api.example.com"
        />
        <div className="hint">
          Общий адрес для всех запросов. Путь из него (например, <code>/api</code>) добавится
          перед путём каждого запроса.
        </div>
      </div>

      <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th style={{ width: 72 }}>#</th>
            <th style={{ width: 100 }}>Метод</th>
            <th>Имя / путь</th>
            <th style={{ width: 90 }}>Параметры</th>
            <th style={{ width: 88 }} />
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr
              key={r.id}
              data-health={healthMark("request-path", r.id)}
              className={dropId === r.id && dragId !== r.id ? "req-drop" : undefined}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (dropId !== r.id) setDropId(r.id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const fromId = e.dataTransfer.getData("text/plain") || dragId || "";
                move(fromId, r.id);
                setDragId(null);
                setDropId(null);
              }}
            >
              <td className="muted req-order">
                <button
                  type="button"
                  className="req-drag"
                  draggable
                  title="Перетащить, чтобы изменить порядок"
                  aria-label="Изменить порядок"
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", r.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDragId(r.id);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setDropId(null);
                  }}
                >
                  <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true">
                    <circle cx="2" cy="2" r="1.2" />
                    <circle cx="8" cy="2" r="1.2" />
                    <circle cx="2" cy="7" r="1.2" />
                    <circle cx="8" cy="7" r="1.2" />
                    <circle cx="2" cy="12" r="1.2" />
                    <circle cx="8" cy="12" r="1.2" />
                  </svg>
                </button>
                {r.order}
              </td>
              <td>
                <select
                  className={`method ${r.method}`}
                  style={{ width: 96 }}
                  value={r.method}
                  onChange={(e) => patch(r.id, { method: e.target.value })}
                >
                  {methods.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  value={r.name}
                  onChange={(e) => patch(r.id, { name: e.target.value })}
                />
                <input
                  style={{ marginTop: 4, fontFamily: "monospace", fontSize: 12 }}
                  value={r.path}
                  placeholder="/path/{id}"
                  onChange={(e) => {
                    patch(r.id, { path: e.target.value });
                    scheduleParamSync(r.id);
                  }}
                  onBlur={(e) => {
                    const path = stripHidden(e.target.value).trim();
                    flushParamSync(r.id, path === r.path ? undefined : { path });
                  }}
                />
                <input
                  style={{ marginTop: 4, fontFamily: "monospace", fontSize: 12 }}
                  value={r.url ?? ""}
                  placeholder="Собственный URL: https://other-host.com/api/{id} (необязательно)"
                  onChange={(e) => {
                    patch(r.id, { url: e.target.value || null });
                    scheduleParamSync(r.id);
                  }}
                  onBlur={(e) => {
                    const url = stripHidden(e.target.value).trim();
                    const next = url || null;
                    flushParamSync(r.id, next === (r.url ?? null) ? undefined : { url: next });
                  }}
                />
                <div className="hint">
                  Параметры в <code>{"{…}"}</code> распознаются автоматически. Собственный URL
                  заменяет базовый URL и путь.
                </div>
              </td>
              <td>
                <span className="tag">{r.params.length}</span>
              </td>
              <td className="req-actions">
                <button
                  type="button"
                  className="ghost small"
                  onClick={() => duplicate(r.id)}
                  title="Дублировать запрос"
                  aria-label="Дублировать запрос"
                >
                  ⧉
                </button>
                <button
                  type="button"
                  className="ghost small"
                  onClick={() => remove(r.id)}
                  title="Удалить запрос"
                  aria-label="Удалить запрос"
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {requests.length === 0 && (
        <div className="hint">Запросов нет — добавьте первый ниже.</div>
      )}

      <h3 style={{ fontSize: 13, margin: "18px 0 8px" }} data-health={healthMark("add-request")}>
        Добавить запрос
      </h3>
      <div className="inline" style={{ flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
        <div className="field" style={{ marginBottom: 0, width: 120 }}>
          <label>Метод</label>
          <select value={newMethod} onChange={(e) => setNewMethod(e.target.value)}>
            {methods.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 180 }}>
          <label>Путь</label>
          <input value={newPath} onChange={(e) => setNewPath(e.target.value)} placeholder="/api/v1/orders" />
        </div>
        <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 160 }}>
          <label>Имя (необязательно)</label>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Создать заказ" />
        </div>
        <button className="ghost" onClick={addRequest}>+ Добавить</button>
      </div>

      <div className="footer-nav" style={{ marginTop: 20 }}>
        <button className="ghost" onClick={onBack}>
          ← Назад
        </button>
        <button onClick={onNext} disabled={requests.length === 0}>
          Далее: корреляция →
        </button>
      </div>
    </div>
  );
}
