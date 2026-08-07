"use client";

import { useState } from "react";
import type { Dataset } from "@/lib/types";

const MAX_ROWS = 2000;

function slug(name: string): string {
  const s = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return (s || "dataset") + ".csv";
}

/** Парсит вставленный CSV/список: первая строка — заголовок (колонки), далее — строки. */
function parse(text: string): { columns: string[]; rows: string[][] } {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { columns: [], rows: [] };
  const split = (line: string) => line.split(",").map((c) => c.trim());
  const columns = split(lines[0]);
  const rows = lines.slice(1, 1 + MAX_ROWS).map(split);
  return { columns, rows };
}

function toText(d: Dataset): string {
  const header = d.columns.join(",");
  const body = d.rows.map((r) => r.join(",")).join("\n");
  return body ? `${header}\n${body}` : header;
}

export function DatasetsEditor({
  datasets,
  onChange,
}: {
  datasets: Dataset[];
  onChange: (d: Dataset[]) => void;
}) {
  // локальный текст на датасет, чтобы редактирование было плавным
  const [texts, setTexts] = useState<Record<string, string>>({});

  function textOf(d: Dataset): string {
    return texts[d.id] ?? toText(d);
  }

  function add() {
    const name = `Датасет ${datasets.length + 1}`;
    const id = `ds_${Date.now().toString(36)}`;
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

  function setData(d: Dataset, text: string) {
    setTexts((t) => ({ ...t, [d.id]: text }));
    const { columns, rows } = parse(text);
    patch(d.id, { columns: columns.length ? columns : d.columns, rows });
  }

  async function upload(d: Dataset, file: File, input: HTMLInputElement) {
    const text = await file.text();
    const { columns, rows } = parse(text);
    setTexts((t) => ({ ...t, [d.id]: text }));
    // Один patch: иначе второй вызов затрёт columns/rows устаревшим datasets.
    patch(d.id, {
      columns: columns.length ? columns : d.columns,
      rows,
      file_name: file.name?.trim() || d.file_name || slug(d.name),
    });
    // Сброс input — иначе браузер не шлёт change при повторном выборе того же файла.
    input.value = "";
  }

  return (
    <div className="panel" style={{ boxShadow: "none" }}>
      <h2>Датасеты (CSV)</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        Общий CSV можно использовать в нескольких запросах. Запросы с одним
        датасетом объединяются в одну тред-группу с единой интенсивностью.
        Вставьте список или загрузите файл: <b>первая строка — названия колонок</b>,
        далее — строки значений (через запятую).
      </p>

      {datasets.map((d) => (
        <div className="group-card" key={d.id}>
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
                <label>Загрузить CSV</label>
                <input
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void upload(d, file, e.target);
                  }}
                />
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

            <div className="field" style={{ marginBottom: 6 }}>
              <label>Данные (вставьте список / CSV)</label>
              <textarea
                rows={6}
                style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}
                placeholder={"username,password\nu1,p1\nu2,p2"}
                value={textOf(d)}
                onChange={(e) => setData(d, e.target.value)}
              />
            </div>
            <div className="hint">
              Колонки: {d.columns.length ? d.columns.join(", ") : "—"} · строк:{" "}
              {d.rows.length} (максимум {MAX_ROWS})
            </div>
          </div>
        </div>
      ))}

      <button className="ghost" onClick={add}>+ Добавить датасет</button>
    </div>
  );
}
