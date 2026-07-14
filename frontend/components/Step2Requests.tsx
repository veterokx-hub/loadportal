"use client";

import { useMemo, useState } from "react";
import type { Param, ParamLocation, RequestModel, Scenario } from "@/lib/types";
import { bracesIn } from "@/lib/request-params";

const METHOD_PRESETS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

function methodOptions(requests: RequestModel[]): string[] {
  const all = new Set(METHOD_PRESETS);
  requests.forEach((r) => {
    if (r.method) all.add(r.method.toUpperCase());
  });
  return Array.from(all);
}

/**
 * Обновляет path/body-параметры из {…}, сохраняя header/query и уже настроенные источники.
 */
function paramsFromText(path: string, body: string, existing: Param[]): Param[] {
  const braceLoc = new Map<string, ParamLocation>();
  bracesIn(path).forEach((n) => braceLoc.set(n, "path"));
  bracesIn(body).forEach((n) => {
    if (!braceLoc.has(n)) braceLoc.set(n, "body");
  });
  const braceNames = new Set(braceLoc.keys());

  const fromBraces: Param[] = Array.from(braceLoc.entries()).map(([name, location]) => {
    const prev = existing.find((p) => p.name === name);
    if (prev) {
      return { ...prev, name, location, required: location === "path" ? true : prev.required };
    }
    return {
      name,
      location,
      source: { kind: "constant" as const, value: "" },
      required: true,
    };
  });

  const kept = existing.filter((p) => {
    if (braceNames.has(p.name)) return false;
    if (p.location === "path") return false;
    return true;
  });

  return [...kept, ...fromBraces];
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

  function addRequest() {
    const path = newPath.trim() || "/";
    const method = newMethod.trim().toUpperCase() || "GET";
    const id = `custom_${Date.now().toString(36)}`;
    const req: RequestModel = {
      id,
      order: requests.length + 1,
      name: newName.trim() || `${method} ${path}`,
      method,
      path,
      headers: [],
      query_params: [],
      body: { mode: "none", content_type: null, content: "" },
      params: paramsFromText(path, "", []),
      extractions: [],
      intensity: { target_rps: 10, ramp_up_sec: 30, hold_sec: 60 },
      validation: { check_response_code: true, expected_status: 200, response_contains: "" },
      dataset_id: null,
      repeat: 1,
    };
    setScenario({ ...scenario, requests: [...scenario.requests, req] });
    setNewName("");
    setNewPath("/");
  }

  function remove(id: string) {
    const filtered = requests
      .filter((r) => r.id !== id)
      .map((r, i) => ({ ...r, order: i + 1 }));
    setScenario({ ...scenario, requests: filtered });
  }

  function patch(id: string, p: Partial<RequestModel>) {
    setScenario({
      ...scenario,
      requests: scenario.requests.map((r) => (r.id === id ? { ...r, ...p } : r)),
    });
  }

  return (
    <div className="panel">
      <h2>2. Запросы сценария</h2>
      <div className="field">
        <label>Базовый URL</label>
        <input
          value={scenario.base_url}
          onChange={(e) => setScenario({ ...scenario, base_url: e.target.value })}
          placeholder="https://api.example.com"
        />
        <div className="hint">
          Домен/протокол/порт попадут в HTTP Request Defaults, путь — в начало
          каждого запроса.
        </div>
      </div>

      <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th style={{ width: 40 }}>#</th>
            <th style={{ width: 100 }}>Метод</th>
            <th>Имя / путь</th>
            <th style={{ width: 90 }}>Параметры</th>
            <th style={{ width: 60 }} />
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.id}>
              <td className="muted">{r.order}</td>
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
                  onChange={(e) =>
                    patch(r.id, {
                      path: e.target.value,
                      params: paramsFromText(e.target.value, r.body?.content ?? "", r.params),
                    })
                  }
                />
                <div className="hint">
                  Параметры в <code>{"{...}"}</code> распознаются автоматически.
                </div>
              </td>
              <td>
                <span className="tag">{r.params.length}</span>
              </td>
              <td>
                <button className="ghost small" onClick={() => remove(r.id)} title="Удалить">
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {requests.length === 0 && (
        <div className="hint">В спецификации не найдено запросов — добавьте свой ниже.</div>
      )}

      <h3 style={{ fontSize: 13, margin: "18px 0 8px" }}>Добавить свой запрос</h3>
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
