"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  Dataset,
  Extraction,
  ExtractionType,
  Param,
  ParamLocation,
  ParamSource,
  RequestModel,
  Scenario,
} from "@/lib/types";
import { ParamSourceEditor } from "@/components/ParamSourceEditor";
import { DatasetsEditor } from "@/components/DatasetsEditor";
import {
  PARAM_LOCATION_LABEL,
  bracesIn,
  consolidateRequestParams,
  uiParams,
} from "@/lib/request-params";

/** Вкладки, куда можно добавлять параметры вручную. */
const ADDABLE_TABS: ParamLocation[] = ["header", "query", "body"];

function sourceEmpty(src: ParamSource): boolean {
  if (src.kind === "constant") return src.value.trim() === "";
  if (src.kind === "csv") return src.column.trim() === "";
  if (src.kind === "correlation") return src.variable.trim() === "";
  return false;
}

function pathTemplateParam(name: string, path: string): boolean {
  return path.includes(`{${name}}`);
}

function PathHighlight({ path }: { path: string }) {
  const parts = path.split(/(\{[a-zA-Z0-9_]+\})/g);
  return (
    <code className="req-path">
      {parts.map((part, i) =>
        part.startsWith("{") && part.endsWith("}") ? (
          <span key={i} className="req-path-param">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </code>
  );
}

function RequestParamsEditor({
  req,
  available,
  columns,
  updateRequest,
}: {
  req: RequestModel;
  available: string[];
  columns: string[];
  updateRequest: (id: string, patch: Partial<RequestModel>) => void;
}) {
  const pathNames = useMemo(() => bracesIn(req.path ?? ""), [req.path]);
  const hasPath = pathNames.length > 0;

  const tabs = useMemo(
    () => (hasPath ? (["header", "query", "body", "path"] as const) : (["header", "query", "body"] as const)),
    [hasPath]
  );

  const visible = uiParams(req);
  const counts = useMemo(() => {
    const c: Record<ParamLocation, number> = { header: 0, query: 0, body: 0, path: 0 };
    for (const p of visible) c[p.location] += 1;
    return c;
  }, [visible]);

  const errorCounts = useMemo(() => {
    const c: Record<ParamLocation, number> = { header: 0, query: 0, body: 0, path: 0 };
    for (const p of visible) {
      if (p.required && sourceEmpty(p.source)) c[p.location] += 1;
    }
    return c;
  }, [visible]);

  const [tab, setTab] = useState<ParamLocation>(() => {
    for (const loc of tabs) {
      if (errorCounts[loc] > 0) return loc;
    }
    for (const loc of tabs) {
      if (counts[loc] > 0) return loc;
    }
    return "header";
  });

  // Если Path исчез (убрали {…} на шаге 2) — уйти с вкладки path.
  useEffect(() => {
    if (tab === "path" && !hasPath) setTab("header");
  }, [tab, hasPath]);

  const rows = req.params
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => {
      if (p.location !== tab) return false;
      if (tab === "path") return pathTemplateParam(p.name, req.path);
      return true;
    });

  function setParamSource(idx: number, source: ParamSource) {
    const params = req.params.map((p, i) => (i === idx ? { ...p, source } : p));
    updateRequest(req.id, { params });
  }

  function patchParam(idx: number, patch: Partial<Param>) {
    const prev = req.params[idx];
    if (prev?.location === "path") {
      // Path: только источник значения, имя/location не меняем.
      if (patch.source) {
        const params = req.params.map((p, i) =>
          i === idx ? { ...p, source: patch.source! } : p
        );
        updateRequest(req.id, { params });
      }
      return;
    }
    const params = req.params.map((p, i) => (i === idx ? { ...p, ...patch } : p));
    updateRequest(req.id, { params });
  }

  function removeParam(idx: number) {
    const p = req.params[idx];
    if (!p || p.location === "path") return;
    updateRequest(req.id, {
      params: req.params.filter((_, i) => i !== idx),
    });
  }

  function addParam(location: ParamLocation) {
    if (location === "path") return;
    const base =
      location === "header" ? "Header" : location === "query" ? "param" : "field";
    let n = 1;
    let name = base;
    while (req.params.some((p) => p.location === location && p.name === name)) {
      n += 1;
      name = `${base}_${n}`;
    }
    const param: Param = {
      name,
      location,
      source: { kind: "constant", value: "" },
      required: false,
    };
    updateRequest(req.id, { params: [...req.params, param] });
    setTab(location);
  }

  const canAdd = ADDABLE_TABS.includes(tab);

  return (
    <div className="req-section">
      <div className="req-section-title">
        Параметры
        <span className="muted">{visible.length} всего</span>
      </div>

      <div className="loc-tabs" role="tablist" aria-label="Тип параметра">
        {tabs.map((loc) => (
          <button
            key={loc}
            type="button"
            role="tab"
            aria-selected={tab === loc}
            className={`loc-tab ${tab === loc ? "active" : ""} ${
              errorCounts[loc] > 0 ? "has-error" : ""
            }`}
            onClick={() => setTab(loc)}
          >
            {PARAM_LOCATION_LABEL[loc]}
            <span className="loc-count">{counts[loc]}</span>
          </button>
        ))}
      </div>

      <div className="param-toolbar">
        <p className="hint">
          {tab === "path"
            ? "Path из шага «Запросы» ({…} в URL). Здесь только настройка значения — добавить или удалить нельзя."
            : tab === "header"
              ? "Заголовки запроса (Authorization, Content-Type…)."
              : tab === "query"
                ? "Query-параметры → ?key=value в URL."
                : "Поля тела (JSON / form)."}
        </p>
        {canAdd && (
          <button type="button" className="ghost small" onClick={() => addParam(tab)}>
            + Добавить
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="param-empty">
          {tab === "path" ? (
            <span>В пути нет параметризованных частей {"{…}"}.</span>
          ) : (
            <>
              <span>Нет параметров «{PARAM_LOCATION_LABEL[tab]}».</span>
              <button type="button" className="ghost small" onClick={() => addParam(tab)}>
                + Добавить
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="param-table">
          <div className="param-table-head">
            <span>Имя</span>
            <span>Источник значения</span>
            <span />
          </div>
          {rows.map(({ p, idx }) => {
            const invalid = p.required && sourceEmpty(p.source);
            const isPath = p.location === "path";
            return (
              <div
                key={`${req.id}-param-${idx}`}
                className={`param-row ${invalid ? "invalid" : ""}`}
              >
                <div className="param-name-cell">
                  {isPath ? (
                    <code className="param-path-name">{"{" + p.name + "}"}</code>
                  ) : (
                    <input
                      placeholder="имя"
                      value={p.name}
                      onChange={(ev) => patchParam(idx, { name: ev.target.value })}
                    />
                  )}
                  <div className="param-name-meta">
                    {isPath && <span>из URL</span>}
                    {p.required && <span className="param-req">обязательный</span>}
                    {p.schema_type && <span>: {p.schema_type}</span>}
                    {invalid && <span className="param-req">заполните значение</span>}
                  </div>
                </div>
                <div className="param-source-cell">
                  <ParamSourceEditor
                    source={p.source}
                    availableVars={available}
                    availableColumns={columns}
                    onChange={(s) => setParamSource(idx, s)}
                  />
                </div>
                {isPath ? (
                  <span />
                ) : (
                  <button
                    type="button"
                    className="param-row-remove"
                    title="Удалить"
                    aria-label="Удалить параметр"
                    onClick={() => removeParam(idx)}
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Step3Correlation({
  scenario,
  setScenario,
  updateRequest,
  onBack,
  onNext,
}: {
  scenario: Scenario;
  setScenario: (s: Scenario) => void;
  updateRequest: (id: string, patch: Partial<RequestModel>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const ordered = [...scenario.requests].sort((a, b) => a.order - b.order);
  const [openIds, setOpenIds] = useState<Set<string>>(
    () => new Set(ordered[0]?.id ? [ordered[0].id] : [])
  );

  // Синхронизация path из URL + миграция headers → params при входе на шаг.
  useEffect(() => {
    setScenario({
      ...scenario,
      requests: scenario.requests.map(consolidateRequestParams),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- однократно при монтировании
  }, []);

  function toggleOpen(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function missingRequired(req: RequestModel): Param[] {
    return uiParams(req).filter((p) => p.required && sourceEmpty(p.source));
  }

  const invalidRequests = ordered.filter((r) => missingRequired(r).length > 0);
  const canProceed = invalidRequests.length === 0;

  function varsBefore(order: number): string[] {
    return ordered
      .filter((r) => r.order < order)
      .flatMap((r) => r.extractions.map((e) => e.variable))
      .filter(Boolean);
  }

  function columnsFor(req: RequestModel): string[] {
    const ds = scenario.datasets.find((d) => d.id === req.dataset_id);
    return ds?.columns ?? [];
  }

  function setDatasets(datasets: Dataset[]) {
    const ids = new Set(datasets.map((d) => d.id));
    const requests = scenario.requests.map((r) =>
      r.dataset_id && !ids.has(r.dataset_id) ? { ...r, dataset_id: null } : r
    );
    setScenario({ ...scenario, datasets, requests });
  }

  function addExtraction(req: RequestModel) {
    const ext: Extraction = {
      variable: `var_${req.extractions.length + 1}`,
      type: "json",
      expression: "$.id",
      match_no: 1,
      default_value: "NOT_FOUND",
    };
    updateRequest(req.id, { extractions: [...req.extractions, ext] });
  }

  function patchExtraction(req: RequestModel, idx: number, p: Partial<Extraction>) {
    const extractions = req.extractions.map((e, i) => (i === idx ? { ...e, ...p } : e));
    updateRequest(req.id, { extractions });
  }

  function removeExtraction(req: RequestModel, idx: number) {
    updateRequest(req.id, {
      extractions: req.extractions.filter((_, i) => i !== idx),
    });
  }

  function setValidation(req: RequestModel, p: Partial<RequestModel["validation"]>) {
    updateRequest(req.id, { validation: { ...req.validation, ...p } });
  }

  return (
    <div className="panel">
      <h2>3. Корреляция и параметры</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        Задайте, как заполняются параметры: константа, генератор, CSV или значение из ответа
        предыдущего запроса. Path берётся из URL шага «Запросы» и только настраивается.
      </p>

      <DatasetsEditor datasets={scenario.datasets} onChange={setDatasets} />

      {ordered.map((req) => {
        const available = varsBefore(req.order);
        const columns = columnsFor(req);
        const isOpen = openIds.has(req.id);
        const visible = uiParams(req);
        const missing = missingRequired(req).length;
        const path = req.path || "/";
        return (
          <div className="request-card" key={req.id}>
            <div
              className="head"
              onClick={() => toggleOpen(req.id)}
              style={{ cursor: "pointer" }}
            >
              <span className={`method ${req.method}`}>{req.method}</span>
              <div className="req-head-title">
                <PathHighlight path={path} />
                {req.name && req.name !== path && req.name !== `${req.method} ${path}` && (
                  <span className="req-head-name">{req.name}</span>
                )}
              </div>
              {req.dataset_id && <span className="badge">CSV</span>}
              {missing > 0 && (
                <span className="tag" style={{ color: "var(--danger)" }}>
                  {missing} без значения
                </span>
              )}
              <span className="tag">{visible.length} парам.</span>
              <span className="tag">{req.extractions.length} экстр.</span>
              <span className="muted">{isOpen ? "▲" : "▼"}</span>
            </div>

            {isOpen && (
              <div className="body">
                <div className="field" style={{ marginBottom: 8 }}>
                  <label>Датасет запроса (общий CSV)</label>
                  <select
                    style={{ maxWidth: 360 }}
                    value={req.dataset_id ?? ""}
                    onChange={(e) =>
                      updateRequest(req.id, { dataset_id: e.target.value || null })
                    }
                  >
                    <option value="">— не используется —</option>
                    {scenario.datasets.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.columns.join(", ")})
                      </option>
                    ))}
                  </select>
                </div>

                <RequestParamsEditor
                  req={req}
                  available={available}
                  columns={columns}
                  updateRequest={updateRequest}
                />

                <div className="req-section">
                  <div className="req-section-title">
                    Извлечь из ответа
                    <span className="muted">для корреляции в следующих запросах</span>
                  </div>

                  {req.extractions.length === 0 ? (
                    <div className="param-empty">
                      <span>Нет извлечений.</span>
                      <button type="button" className="ghost small" onClick={() => addExtraction(req)}>
                        + Добавить
                      </button>
                    </div>
                  ) : (
                    <div className="param-table extract-table">
                      <div className="param-table-head">
                        <span>Переменная</span>
                        <span>Тип</span>
                        <span>Выражение</span>
                        <span />
                      </div>
                      {req.extractions.map((e, idx) => (
                        <div key={idx} className="param-row">
                          <input
                            style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}
                            placeholder="переменная"
                            value={e.variable}
                            onChange={(ev) =>
                              patchExtraction(req, idx, { variable: ev.target.value })
                            }
                          />
                          <select
                            value={e.type}
                            onChange={(ev) =>
                              patchExtraction(req, idx, {
                                type: ev.target.value as ExtractionType,
                              })
                            }
                          >
                            <option value="json">JSONPath</option>
                            <option value="regex">Regex</option>
                            <option value="boundary">Boundary</option>
                          </select>
                          <input
                            placeholder={
                              e.type === "json"
                                ? "$.token"
                                : e.type === "boundary"
                                  ? "left|right"
                                  : "\"token\":\"(.+?)\""
                            }
                            value={e.expression}
                            onChange={(ev) =>
                              patchExtraction(req, idx, { expression: ev.target.value })
                            }
                          />
                          <button
                            type="button"
                            className="param-row-remove"
                            title="Удалить"
                            aria-label="Удалить извлечение"
                            onClick={() => removeExtraction(req, idx)}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {req.extractions.length > 0 && (
                    <div className="param-toolbar" style={{ marginTop: 8 }}>
                      <span />
                      <button type="button" className="ghost small" onClick={() => addExtraction(req)}>
                        + Извлечение
                      </button>
                    </div>
                  )}

                  {available.length > 0 && (
                    <div className="hint" style={{ marginTop: 8 }}>
                      Доступно из предыдущих запросов:{" "}
                      {available.map((v) => (
                        <code key={v} style={{ marginRight: 4 }}>
                          ${"{"}
                          {v}
                          {"}"}
                        </code>
                      ))}
                    </div>
                  )}
                </div>

                <div className="req-section">
                  <div className="req-section-title">Валидация ответа</div>
                  <div className="row">
                    <div className="field" style={{ flex: "none" }}>
                      <label>Проверять код</label>
                      <label className="inline" style={{ textTransform: "none" }}>
                        <input
                          type="checkbox"
                          style={{ width: "auto" }}
                          checked={req.validation.check_response_code}
                          onChange={(e) =>
                            setValidation(req, { check_response_code: e.target.checked })
                          }
                        />
                        <span className="muted">Response Assertion</span>
                      </label>
                    </div>
                    <div className="field" style={{ width: 140, flex: "none" }}>
                      <label>Ожидаемый код</label>
                      <input
                        type="number"
                        value={req.validation.expected_status}
                        onChange={(e) =>
                          setValidation(req, { expected_status: Number(e.target.value) })
                        }
                      />
                    </div>
                    <div className="field" style={{ flex: 1, minWidth: 220 }}>
                      <label>Тело содержит текст (Contains)</label>
                      <input
                        value={req.validation.response_contains}
                        placeholder='"id"'
                        onChange={(e) =>
                          setValidation(req, { response_contains: e.target.value })
                        }
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {!canProceed && (
        <div className="error" style={{ marginTop: 12 }}>
          Заполните обязательные параметры:{" "}
          {invalidRequests.map((r) => r.name).join(", ")}
        </div>
      )}

      <div className="footer-nav">
        <button className="ghost" onClick={onBack}>
          ← Назад
        </button>
        <button onClick={onNext} disabled={!canProceed}>
          Далее: интенсивность →
        </button>
      </div>
    </div>
  );
}
