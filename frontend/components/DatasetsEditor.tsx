"use client";

import { useEffect, useState } from "react";
import type { Dataset } from "@/lib/types";
import { FileUploadButton } from "@/components/FileUploadButton";
import { plural } from "@/lib/plural";
import { csvField, csvRecords } from "@/lib/csv";
import { healthMark, useHealthFocus } from "@/lib/health-focus";
import { gatlingScriptName, keepLettersDigits } from "@/lib/script-vars";

const MAX_ROWS = 2000;

function slug(name: string): string {
  const s = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return (s || "dataset") + ".csv";
}

/** Первая строка — заголовок (колонки), далее — данные; total — сколько строк было до обрезки. */
function parse(text: string): { columns: string[]; rows: string[][]; total: number } {
  const [columns = [], ...data] = csvRecords(text);
  return { columns, rows: data.slice(0, MAX_ROWS), total: data.length };
}

function toText(d: Dataset): string {
  const header = d.columns.map(csvField).join(",");
  const body = d.rows.map((r) => r.map(csvField).join(",")).join("\n");
  return body ? `${header}\n${body}` : header;
}

export function DatasetsEditor({
  datasets,
  onChange,
  clashNames,
}: {
  datasets: Dataset[];
  onChange: (d: Dataset[]) => void;
  clashNames?: Set<string>;
}) {
  // локальный текст на датасет, чтобы редактирование было плавным
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [cleaned, setCleaned] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState(datasets.length === 0);
  const health = useHealthFocus();

  useEffect(() => {
    if (health?.step === 2 && health.place === "datasets") setOpen(true);
  }, [health]);

  function textOf(d: Dataset): string {
    return texts[d.id] ?? toText(d);
  }

  function add() {
    const name = `Датасет ${datasets.length + 1}`;
    const id = `ds_${Date.now().toString(36)}`;
    setOpen(true);
    onChange([
      ...datasets,
      { id, name, file_name: slug(name), columns: ["col1"], rows: [], random: false },
    ]);
  }

  function patch(id: string, p: Partial<Dataset>) {
    onChange(datasets.map((d) => (d.id === id ? { ...d, ...p } : d)));
  }

  function remove(id: string) {
    onChange(datasets.filter((d) => d.id !== id));
    setTexts((t) => {
      const rest = { ...t };
      delete rest[id];
      return rest;
    });
  }

  function applyColumns(d: Dataset, columns: string[], rows: string[][], fileName?: string) {
    const nextCols = columns.map((c) => keepLettersDigits(c));
    const changed = nextCols.some((c, i) => c !== columns[i]);
    const cols = nextCols.length ? nextCols : d.columns;
    const sameCols =
      cols.length === d.columns.length && cols.every((c, i) => c === d.columns[i]);
    const sameRows = JSON.stringify(rows) === JSON.stringify(d.rows);
    if (!changed && sameCols && sameRows && !fileName) return;
    // Локальный текст приоритетнее датасета. Без перезаписи загрузка файла
    // оставляет в окне то, что пользователь правил до неё.
    if (fileName || changed) {
      setTexts((t) => ({ ...t, [d.id]: toText({ ...d, columns: cols, rows }) }));
    }
    if (fileName) setCleaned((t) => ({ ...t, [d.id]: changed }));
    else if (changed) setCleaned((t) => ({ ...t, [d.id]: true }));
    patch(d.id, {
      columns: cols,
      rows,
      ...(fileName ? { file_name: fileName } : {}),
    });
  }

  function commitColumns(d: Dataset) {
    const { columns, rows } = parse(textOf(d));
    applyColumns(d, columns.length ? columns : d.columns, rows);
  }

  function setData(d: Dataset, text: string) {
    setTexts((t) => ({ ...t, [d.id]: text }));
    const { columns, rows, total } = parse(text);
    setTotals((t) => ({ ...t, [d.id]: total }));
    patch(d.id, { columns: columns.length ? columns : d.columns, rows });
  }

  async function upload(d: Dataset, file: File) {
    const text = await file.text();
    const { columns, rows, total } = parse(text);
    setTotals((t) => ({ ...t, [d.id]: total }));
    applyColumns(d, columns.length ? columns : d.columns, rows, file.name?.trim() || d.file_name || slug(d.name));
  }

  const summary =
    datasets.length === 0
      ? "нет"
      : `${datasets.length} ${plural(datasets.length, "датасет", "датасета", "датасетов")} · ${datasets.map((d) => d.name).join(", ")}`;

  return (
    <div className="panel" style={{ boxShadow: "none" }}>
      <details
        className="csv-section"
        open={open}
        onToggle={(e) => {
          if (e.target !== e.currentTarget) return;
          setOpen((e.currentTarget as HTMLDetailsElement).open);
        }}
      >
      <summary>
        <h2>Датасеты (CSV)</h2>
        <span className="csv-data-meta muted">{summary}</span>
      </summary>
      <p className="muted" style={{ marginTop: 0 }}>
        Запросы с общим датасетом объединяются в одну группу с единой интенсивностью.{" "}
        <b>Первая строка — названия колонок</b>, далее — значения через запятую или точку с
        запятой. Значение с запятой или кавычкой возьмите в кавычки:{" "}
        <code>&quot;Москва, Тверская&quot;</code>.
      </p>

      {datasets.map((d) => (
        <div className="group-card" key={d.id} data-health={healthMark("datasets", "", "", d.id)}>
          <div className="head">
            <span className="badge">CSV</span>
            <input
              style={{ width: 200 }}
              value={d.name}
              onChange={(e) => patch(d.id, { name: e.target.value })}
            />
            <span className="muted" style={{ fontSize: 12 }}>→ {d.file_name}</span>
            <span className="spacer" />
            <button className="ghost small" onClick={() => remove(d.id)}>✕ Удалить</button>
          </div>
          <div className="body">
            <div className="row">
              <div className="field" style={{ flex: 1 }}>
                <label>Имя файла</label>
                <input value={d.file_name} onChange={(e) => patch(d.id, { file_name: e.target.value })} />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>Файл</label>
                <FileUploadButton accept=".csv,text/csv,text/plain" onPick={(file) => void upload(d, file)} />
              </div>
              <div className="field" style={{ flex: "none", width: 200 }}>
                <label>Выбор строк</label>
                <label className="inline" style={{ textTransform: "none" }}>
                  <input
                    type="checkbox"
                    style={{ width: "auto" }}
                    checked={d.random}
                    onChange={(e) => patch(d.id, { random: e.target.checked })}
                  />
                  <span className="muted">случайный (Random CSV)</span>
                </label>
              </div>
            </div>

            <details className="csv-data">
              <summary>
                <span>Данные</span>
                <span className="csv-data-meta muted">
                  {d.columns.length ? d.columns.join(", ") : "—"} · {d.rows.length}{" "}
                  {plural(d.rows.length, "строка", "строки", "строк")}
                </span>
              </summary>
              <textarea
                className="script-var"
                rows={6}
                style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}
                placeholder={"username,password\nu1,p1\nu2,p2"}
                title="Названия колонок попадут в скрипт"
                value={textOf(d)}
                onChange={(e) => setData(d, e.target.value)}
                onBlur={() => commitColumns(d)}
              />
              <div className="hint">
                В названии колонки — только латинские буквы и цифры. В сценарий попадут первые {MAX_ROWS} строк.
              </div>
            </details>
            {cleaned[d.id] && (
              <div className="field-warn" style={{ marginTop: 4 }}>
                В названиях колонок оставлены только буквы и цифры.
              </div>
            )}
            {d.columns.some((c) => clashNames?.has(c.trim())) && (
              <div className="field-warn" style={{ marginTop: 4 }}>
                Имя колонки уже занято другой переменной скрипта:{" "}
                {d.columns.filter((c) => clashNames?.has(c.trim())).join(", ")}
              </div>
            )}
            {d.columns.some((c) => {
              const n = c.trim();
              return n !== "" && gatlingScriptName(n) !== n;
            }) && (
              <div className="field-warn" style={{ marginTop: 4 }}>
                {d.columns
                  .map((c) => c.trim())
                  .filter((n) => n !== "" && gatlingScriptName(n) !== n)
                  .map((n) => `«${n}» в Gatling станет «${gatlingScriptName(n)}»`)
                  .join(". ")}
                . (Gatling)
              </div>
            )}
            {(totals[d.id] ?? 0) > MAX_ROWS && (
              <div className="field-warn" style={{ marginTop: 4 }}>
                В данных {totals[d.id]} {plural(totals[d.id], "строка", "строки", "строк")} — в сценарий попадут первые {MAX_ROWS}.
              </div>
            )}
          </div>
        </div>
      ))}

      <button className="ghost" onClick={add}>+ Добавить датасет</button>
      </details>
    </div>
  );
}
