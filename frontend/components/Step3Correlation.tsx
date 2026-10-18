"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  Dataset,
  Extraction,
  ExtractionType,
  Param,
  ParamLocation,
  ParamSource,
  RequestModel,
  Scenario,
  Validation,
} from "@/lib/types";
import { ParamSourceEditor } from "@/components/ParamSourceEditor";
import { DatasetsEditor } from "@/components/DatasetsEditor";
import { NumberField } from "@/components/NumberField";
import { healthMark, revealHealth, useHealthFocus } from "@/lib/health-focus";
import { tidyPasted } from "@/lib/paste";
import {
  PARAM_LOCATION_LABEL,
  bracesInAddress,
  consolidateRequestParams,
  paramsFromTemplates,
  uiParams,
  urlTemplate,
} from "@/lib/request-params";
import {
  gatlingScriptName,
  keepLettersDigits,
  paramScriptKind,
  scriptVarClashes,
  scriptWriters,
} from "@/lib/script-vars";

/** Вкладки, куда можно добавлять параметры вручную. */
const ADDABLE_TABS: ParamLocation[] = ["header", "query", "body"];

function sourceEmpty(src: ParamSource): boolean {
  if (src.kind === "constant") return src.value.trim() === "";
  if (src.kind === "csv") return src.column.trim() === "";
  if (src.kind === "correlation") return src.variable.trim() === "";
  return false;
}

function validationCustom(v: Validation): boolean {
  return (
    !v.check_response_code ||
    v.expected_status !== 200 ||
    (v.response_contains ?? "").trim() !== ""
  );
}

function validationSummary(v: Validation): string {
  if (!v.check_response_code && !(v.response_contains ?? "").trim()) return "выключена";
  const bits: string[] = [];
  if (v.check_response_code) bits.push(`код ${v.expected_status}`);
  const contains = (v.response_contains ?? "").trim();
  if (contains) bits.push(`содержит «${contains}»`);
  return bits.join(" · ");
}

function FoldSection({
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string;
  summary?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className={`req-section ${open ? "is-open" : "is-folded"}`}>
      <button
        type="button"
        className="ghost req-section-toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="req-section-title">
          {title}
          {summary != null && summary !== "" && <span className="muted">{summary}</span>}
        </span>
        <span className="muted">{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="req-section-body">{children}</div>}
    </div>
  );
}

/** Режим тела по содержимому: пусто → none, JSON-подобное → json, иначе raw. */
function bodyModeFor(content: string, prev?: RequestModel["body"]): RequestModel["body"] {
  const trimmed = content.trim();
  if (trimmed === "") {
    return { mode: "none", content_type: prev?.content_type ?? null, content };
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return { mode: "json", content_type: prev?.content_type || "application/json", content };
  }
  return { mode: "raw", content_type: prev?.content_type ?? null, content };
}

function PathHighlight({ path, open }: { path: string; open: Set<string> }) {
  const parts = path.split(/(\{[a-zA-Z0-9_]+\})/g);
  return (
    <code className="req-path">
      {parts.map((part, i) => {
        if (!(part.startsWith("{") && part.endsWith("}"))) {
          return <span key={i}>{part}</span>;
        }
        const name = part.slice(1, -1);
        const pending = open.has(name);
        return (
          <span key={i} className={`req-path-param ${pending ? "is-open" : "is-bound"}`}>
            {part}
          </span>
        );
      })}
    </code>
  );
}

function RequestParamsEditor({
  req,
  available,
  columns,
  clashNames,
  focusTab,
  focusToken,
  updateRequest,
}: {
  req: RequestModel;
  available: string[];
  columns: string[];
  clashNames: Set<string>;
  focusTab?: ParamLocation;
  focusToken?: number;
  updateRequest: (id: string, patch: Partial<RequestModel>) => void;
}) {
  const pathNames = useMemo(() => bracesInAddress(req), [req]);
  const hasPath =
    pathNames.length > 0 || req.params.some((p) => p.location === "path");

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

  useEffect(() => {
    if (focusTab) setTab(focusTab);
  }, [focusToken, focusTab]);

  // Если Path исчез (убрали {…} на шаге 2) — уйти с вкладки path.
  useEffect(() => {
    if (tab === "path" && !hasPath) setTab("header");
  }, [tab, hasPath]);

  const rows = req.params
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => p.location === tab);

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

  const reqRef = useRef(req);
  reqRef.current = req;
  const bodyTimer = useRef<number>(0);
  const [pasteNote, setPasteNote] = useState<string | null>(null);

  function setBodyContent(content: string, immediate = false) {
    updateRequest(req.id, { body: bodyModeFor(content, req.body) });
    const apply = () => {
      const r = reqRef.current;
      updateRequest(r.id, {
        body: bodyModeFor(content, r.body),
        params: paramsFromTemplates(urlTemplate(r), content, r.params),
      });
    };
    window.clearTimeout(bodyTimer.current);
    if (immediate) apply();
    else bodyTimer.current = window.setTimeout(apply, 450);
  }

  function addParam(location: ParamLocation) {
    if (location === "path") return;
    const base =
      location === "header" ? "Header" : location === "query" ? "param" : "field";
    let n = 1;
    let name = base;
    while (req.params.some((p) => p.name.trim() === name)) {
      n += 1;
      name = `${base}${n}`;
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
            ? "Берутся из {…} в адресе на шаге «Запросы». Здесь задаётся только значение."
            : tab === "header"
              ? "Заголовки запроса (Authorization, Content-Type…)."
              : tab === "query"
                ? "Добавляются в URL как ?key=value."
                : "Поля тела (JSON / form)."}
        </p>
        {canAdd && (
          <button type="button" className="ghost small" onClick={() => addParam(tab)}>
            + Добавить
          </button>
        )}
      </div>

      {tab === "body" && (
        <div className="field" data-health={healthMark("body", req.id)}>
          <label>Тело запроса (Body)</label>
          <textarea
            style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, minHeight: 96 }}
            placeholder={'{"login": "{username}", "password": "{password}"}'}
            value={req.body?.content ?? ""}
            onChange={(e) => {
              setPasteNote(null);
              setBodyContent(e.target.value);
            }}
            onBlur={(e) => {
              const tidied = tidyPasted(e.target.value);
              if (tidied.changed) {
                setPasteNote(
                  tidied.formatted
                    ? "Скрытые символы убраны, тело приведено к JSON."
                    : "Скрытые символы убраны."
                );
              }
              setBodyContent(tidied.text, true);
            }}
          />
          <div className="hint">
            Каждый <code>{"{…}"}</code> станет параметром Body в таблице ниже.
            {pasteNote && <> {pasteNote}</>}
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="param-empty">
          {tab === "path" ? (
            <span>В адресе нет параметров {"{…}"}.</span>
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
            const scriptKind = paramScriptKind(p);
            const scriptName = p.name.trim();
            const nameClash = !!scriptKind && clashNames.has(scriptName);
            const gatlingName = scriptKind ? gatlingScriptName(scriptName) : scriptName;
            const nameDrift = !!scriptKind && scriptName !== "" && gatlingName !== scriptName;
            const invalid = p.required && sourceEmpty(p.source);
            const isPath = p.location === "path";
            return (
              <div
                key={`${req.id}-param-${idx}`}
                className={`param-row ${invalid ? "invalid" : ""}`}
                data-health={healthMark("param", req.id, p.location, p.name.trim())}
              >
                <div className="param-name-cell">
                  {isPath ? (
                    <code className={`param-path-name${scriptKind ? " script-var" : ""}`}>
                      {"{" + p.name + "}"}
                    </code>
                  ) : (
                    <input
                      className={scriptKind ? "script-var" : undefined}
                      placeholder="имя"
                      title={scriptKind ? "Имя попадёт в скрипт" : undefined}
                      value={p.name}
                      onChange={(ev) =>
                        patchParam(idx, {
                          name: scriptKind ? keepLettersDigits(ev.target.value) : ev.target.value,
                        })
                      }
                    />
                  )}
                  {(isPath || invalid || p.schema_type || nameClash || nameDrift) && (
                    <div className="param-name-meta">
                      {isPath && <span>из URL</span>}
                      {invalid && <span className="param-req">обязательный</span>}
                      {nameClash && <span className="param-warn">имя переменной занято</span>}
                      {nameDrift && (
                        <span className="param-warn">в Gatling станет «{gatlingName}»</span>
                      )}
                      {p.schema_type && <span>: {p.schema_type}</span>}
                    </div>
                  )}
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
  const health = useHealthFocus();
  const [openIds, setOpenIds] = useState<Set<string>>(
    () => new Set(ordered[0]?.id ? [ordered[0].id] : [])
  );
  const [fold, setFold] = useState<Record<string, { extract?: boolean; valid?: boolean }>>({});

  function extractOpen(req: RequestModel): boolean {
    return fold[req.id]?.extract ?? req.extractions.length > 0;
  }

  function validOpen(req: RequestModel): boolean {
    return fold[req.id]?.valid ?? validationCustom(req.validation);
  }

  function setFoldOpen(id: string, key: "extract" | "valid", open: boolean) {
    setFold((prev) => ({ ...prev, [id]: { ...prev[id], [key]: open } }));
  }

  // Синхронизация path из URL + миграция headers → params при входе на шаг.
  // Не вызываем setScenario, если ничего не поменялось — иначе чистая сборка
  // из истории помечается как изменённая.
  useEffect(() => {
    const requests = scenario.requests.map(consolidateRequestParams);
    if (JSON.stringify(requests) === JSON.stringify(scenario.requests)) return;
    setScenario({ ...scenario, requests });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- однократно при монтировании
  }, []);

  useEffect(() => {
    if (!health || health.step !== 2) return;
    if (health.requestId) {
      setOpenIds((prev) => {
        if (prev.has(health.requestId!)) return prev;
        const next = new Set(prev);
        next.add(health.requestId!);
        return next;
      });
      if (health.place === "extract") setFoldOpen(health.requestId, "extract", true);
    }
    const timer = window.setTimeout(() => revealHealth(health), 200);
    return () => window.clearTimeout(timer);
  }, [health]);

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

  const clashNames = useMemo(() => {
    const names = new Set<string>();
    for (const c of scriptVarClashes(scriptWriters(scenario))) names.add(c.name);
    return names;
  }, [scenario]);

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
    const taken = new Set(scriptWriters(scenario).map((w) => w.name));
    let n = req.extractions.length + 1;
    let variable = `var${n}`;
    while (taken.has(variable)) {
      n += 1;
      variable = `var${n}`;
    }
    const ext: Extraction = {
      variable,
      type: "json",
      expression: "$.id",
      match_no: 1,
      default_value: "NOT_FOUND",
    };
    updateRequest(req.id, { extractions: [...req.extractions, ext] });
    setFoldOpen(req.id, "extract", true);
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
        Выберите источник каждого параметра: константа, генератор, CSV или корреляция — значение
        из ответа предыдущего запроса.
      </p>

      <DatasetsEditor
        datasets={scenario.datasets}
        onChange={setDatasets}
        clashNames={clashNames}
      />

      {ordered.map((req) => {
        const available = varsBefore(req.order);
        const columns = columnsFor(req);
        const isOpen = openIds.has(req.id);
        const visible = uiParams(req);
        const missing = missingRequired(req).length;
        const path = urlTemplate(req) || "/";
        const openParams = new Set(missingRequired(req).map((p) => p.name));
        return (
          <div className="request-card" key={req.id}>
            <div
              className="head"
              onClick={() => toggleOpen(req.id)}
              style={{ cursor: "pointer" }}
            >
              <span className={`method ${req.method}`}>{req.method}</span>
              <div className="req-head-title">
                <PathHighlight path={path} open={openParams} />
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
              <span className="tag">{req.extractions.length} извл.</span>
              <span className="muted">{isOpen ? "▲" : "▼"}</span>
            </div>

            {isOpen && (
              <div className="body">
                <div
                  className="field"
                  style={{ marginBottom: 8 }}
                  data-health={healthMark("dataset", req.id)}
                >
                  <label>Датасет (CSV)</label>
                  <select
                    style={{ maxWidth: 360 }}
                    value={req.dataset_id ?? ""}
                    onChange={(e) =>
                      updateRequest(req.id, { dataset_id: e.target.value || null })
                    }
                  >
                    <option value="">— без датасета —</option>
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
                  clashNames={clashNames}
                  focusTab={
                    health?.step === 2 && health.requestId === req.id
                      ? health.place === "body"
                        ? "body"
                        : health.place === "param"
                          ? health.location
                          : undefined
                      : undefined
                  }
                  focusToken={health?.token}
                  updateRequest={updateRequest}
                />

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

                <div data-health={healthMark("extract", req.id)}>
                <FoldSection
                  title="Извлечь из ответа"
                  summary={
                    req.extractions.length > 0
                      ? `${req.extractions.length} · ${req.extractions.map((e) => e.variable).filter(Boolean).join(", ")}`
                      : "не используется"
                  }
                  open={extractOpen(req)}
                  onToggle={() => setFoldOpen(req.id, "extract", !extractOpen(req))}
                >
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
                      {req.extractions.map((e, idx) => {
                        const variable = e.variable.trim();
                        const taken = clashNames.has(variable);
                        const gatlingName = gatlingScriptName(variable);
                        const drift = variable !== "" && gatlingName !== variable;
                        return (
                        <div
                          key={idx}
                          className="param-row"
                          data-health={healthMark("extract", req.id, "", e.variable.trim())}
                        >
                          <div className="param-name-cell">
                            <input
                              className="script-var"
                              style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}
                              placeholder="переменная"
                              title="Имя попадёт в скрипт"
                              value={e.variable}
                              onChange={(ev) =>
                                patchExtraction(req, idx, {
                                  variable: keepLettersDigits(ev.target.value),
                                })
                              }
                            />
                            {(taken || drift) && (
                              <div className="param-name-meta">
                                {taken && <span className="param-warn">имя переменной занято</span>}
                                {drift && (
                                  <span className="param-warn">в Gatling станет «{gatlingName}»</span>
                                )}
                              </div>
                            )}
                          </div>
                          <select
                            value={e.type}
                            onChange={(ev) => {
                              const type = ev.target.value as ExtractionType;
                              patchExtraction(req, idx, {
                                type,
                                expression:
                                  e.expression === "$.id" && type !== "json" ? "" : e.expression,
                              });
                            }}
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
                        );
                      })}
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
                </FoldSection>
                </div>

                <FoldSection
                  title="Валидация ответа"
                  summary={validationSummary(req.validation)}
                  open={validOpen(req)}
                  onToggle={() => setFoldOpen(req.id, "valid", !validOpen(req))}
                >
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
                      <NumberField
                        fieldId={`status-${req.id}`}
                        value={req.validation.expected_status}
                        min={100}
                        onCommit={(n) => setValidation(req, { expected_status: n })}
                      />
                    </div>
                    <div className="field" style={{ flex: 1, minWidth: 220 }}>
                      <label>Тело ответа содержит</label>
                      <input
                        value={req.validation.response_contains}
                        placeholder='"id"'
                        onChange={(e) =>
                          setValidation(req, { response_contains: e.target.value })
                        }
                      />
                    </div>
                  </div>
                </FoldSection>
              </div>
            )}
          </div>
        );
      })}

      {invalidRequests.length > 0 && (
        <div className="error" style={{ marginTop: 12 }}>
          Заполните обязательные параметры:{" "}
          {invalidRequests
            .map((r) => `${r.name} (${missingRequired(r).map((p) => p.name).join(", ")})`)
            .join("; ")}
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
