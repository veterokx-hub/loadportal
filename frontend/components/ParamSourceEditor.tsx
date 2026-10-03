"use client";

import type { ReactNode } from "react";
import type { GeneratorType, ParamSource } from "@/lib/types";
import { NumberField } from "@/components/NumberField";

const GENERATORS: { value: GeneratorType; label: string }[] = [
  { value: "uuid", label: "UUID" },
  { value: "randomInt", label: "Случайное число" },
  { value: "randomString", label: "Случайная строка" },
  { value: "counter", label: "Счётчик" },
  { value: "timestamp", label: "Метка времени" },
];

const TS_PRESETS: { value: string; label: string }[] = [
  { value: "", label: "мс (Unix)" },
  { value: "yyyy-MM-dd", label: "yyyy-MM-dd" },
  { value: "yyyy-MM-dd'T'HH:mm:ss", label: "yyyy-MM-dd'T'HH:mm:ss" },
  { value: "dd.MM.yyyy HH:mm:ss", label: "dd.MM.yyyy HH:mm:ss" },
  { value: "yyyyMMddHHmmss", label: "yyyyMMddHHmmss" },
];

const TS_OTHER = "__other__";

const KIND_LABEL: Record<ParamSource["kind"], string> = {
  constant: "Константа",
  generator: "Генератор",
  correlation: "Корреляция",
  csv: "CSV",
};

function GenSlot({
  label,
  title,
  wide,
  children,
}: {
  label: string;
  title?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={`param-gen-slot${wide ? " wide" : ""}`} title={title}>
      <span className="param-gen-label">{label}</span>
      {children}
    </label>
  );
}

export function ParamSourceEditor({
  source,
  availableVars,
  availableColumns = [],
  onChange,
}: {
  source: ParamSource;
  availableVars: string[];
  availableColumns?: string[];
  onChange: (s: ParamSource) => void;
}) {
  function setKind(kind: ParamSource["kind"]) {
    switch (kind) {
      case "constant":
        onChange({ kind: "constant", value: "" });
        break;
      case "generator":
        onChange({ kind: "generator", generator: { type: "uuid" } });
        break;
      case "correlation":
        onChange({ kind: "correlation", variable: availableVars[0] ?? "" });
        break;
      case "csv":
        onChange({ kind: "csv", column: "" });
        break;
    }
  }

  const genType = source.kind === "generator" ? source.generator.type : "uuid";
  const genTypeLabel = GENERATORS.find((g) => g.value === genType)?.label ?? "";
  const tsFormat = source.kind === "generator" ? source.generator.format ?? "" : "";
  const tsIsOther =
    source.kind === "generator" &&
    source.generator.type === "timestamp" &&
    tsFormat !== "" &&
    !TS_PRESETS.some((p) => p.value === tsFormat);

  return (
    <div className="param-source">
      <select
        value={source.kind}
        onChange={(e) => setKind(e.target.value as ParamSource["kind"])}
        aria-label="Источник значения"
      >
        {(Object.keys(KIND_LABEL) as ParamSource["kind"][]).map((k) => (
          <option key={k} value={k}>
            {KIND_LABEL[k]}
          </option>
        ))}
      </select>

      <div className="param-source-value">
        {source.kind === "constant" && (
          <input
            placeholder="значение, ${var} или ${__fn()}"
            value={source.value}
            onChange={(e) => onChange({ kind: "constant", value: e.target.value })}
          />
        )}

        {source.kind === "generator" && (
          <>
            <select
              className="fit"
              style={{ width: `calc(${Math.max(genTypeLabel.length, 4)}ch + 2.6em)` }}
              value={source.generator.type}
              onChange={(e) => {
                const type = e.target.value as GeneratorType;
                onChange({
                  kind: "generator",
                  generator:
                    type === "counter"
                      ? { type, start: source.generator.start ?? 1, increment: source.generator.increment ?? 1 }
                      : { ...source.generator, type },
                });
              }}
            >
              {GENERATORS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
            {source.generator.type === "randomInt" && (
              <div className="param-gen-extras">
                <GenSlot label="Мин">
                  <NumberField
                    fieldId="gen-min"
                    value={source.generator.min ?? 0}
                    required={false}
                    onCommit={(n) =>
                      onChange({
                        kind: "generator",
                        generator: { ...source.generator, min: n },
                      })
                    }
                  />
                </GenSlot>
                <GenSlot label="Макс">
                  <NumberField
                    fieldId="gen-max"
                    value={source.generator.max ?? 0}
                    required={false}
                    onCommit={(n) =>
                      onChange({
                        kind: "generator",
                        generator: { ...source.generator, max: n },
                      })
                    }
                  />
                </GenSlot>
              </div>
            )}
            {source.generator.type === "counter" && (
              <div className="param-gen-extras">
                <GenSlot label="Старт">
                  <NumberField
                    fieldId="cnt-start"
                    value={source.generator.start ?? 1}
                    required={false}
                    onCommit={(n) =>
                      onChange({
                        kind: "generator",
                        generator: { ...source.generator, start: n },
                      })
                    }
                  />
                </GenSlot>
                <GenSlot label="Шаг">
                  <NumberField
                    fieldId="cnt-incr"
                    value={source.generator.increment ?? 1}
                    required={false}
                    onCommit={(n) =>
                      onChange({
                        kind: "generator",
                        generator: { ...source.generator, increment: n },
                      })
                    }
                  />
                </GenSlot>
                <GenSlot label="Макс" title="0 — без ограничения, по достижении снова старт">
                  <NumberField
                    fieldId="cnt-max"
                    value={source.generator.max ?? 0}
                    required={false}
                    onCommit={(n) =>
                      onChange({
                        kind: "generator",
                        generator: { ...source.generator, max: n },
                      })
                    }
                  />
                </GenSlot>
                <GenSlot label="Формат" title="Маска нулей, например 000 → 001">
                  <input
                    placeholder="000"
                    value={source.generator.format ?? ""}
                    onChange={(e) =>
                      onChange({
                        kind: "generator",
                        generator: { ...source.generator, format: e.target.value },
                      })
                    }
                  />
                </GenSlot>
              </div>
            )}
            {source.generator.type === "randomString" && (
              <div className="param-gen-extras">
                <GenSlot label="Длина">
                  <NumberField
                    fieldId="gen-len"
                    value={source.generator.length ?? 8}
                    min={1}
                    required={false}
                    onCommit={(n) =>
                      onChange({
                        kind: "generator",
                        generator: { ...source.generator, length: n },
                      })
                    }
                  />
                </GenSlot>
              </div>
            )}
            {source.generator.type === "timestamp" && (
              <div className="param-gen-extras">
                <GenSlot label="Формат" wide>
                  <select
                    className="wide"
                    value={tsIsOther ? TS_OTHER : tsFormat}
                    onChange={(e) => {
                      const v = e.target.value;
                      onChange({
                        kind: "generator",
                        generator: {
                          ...source.generator,
                          format: v === TS_OTHER ? "yyyy-MM-dd HH:mm:ss" : v,
                        },
                      });
                    }}
                  >
                    {TS_PRESETS.map((p) => (
                      <option key={p.value || "unix"} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                    <option value={TS_OTHER}>Другое…</option>
                  </select>
                </GenSlot>
                {tsIsOther && (
                  <GenSlot label="Шаблон" wide>
                    <input
                      placeholder="yyyy-MM-dd HH:mm:ss"
                      value={tsFormat}
                      onChange={(e) =>
                        onChange({
                          kind: "generator",
                          generator: { ...source.generator, format: e.target.value },
                        })
                      }
                    />
                  </GenSlot>
                )}
              </div>
            )}
          </>
        )}

        {source.kind === "correlation" && (
          <select
            value={source.variable}
            onChange={(e) => onChange({ kind: "correlation", variable: e.target.value })}
          >
            {availableVars.length === 0 && (
              <option value="">нет переменных из предыдущих запросов</option>
            )}
            {availableVars.map((v) => (
              <option key={v} value={v}>
                ${"{"}
                {v}
                {"}"}
              </option>
            ))}
          </select>
        )}

        {source.kind === "csv" &&
          (availableColumns.length > 0 ? (
            <select
              value={source.column}
              onChange={(e) => onChange({ kind: "csv", column: e.target.value })}
            >
              <option value="">— колонка датасета —</option>
              {availableColumns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          ) : (
            <input
              placeholder="сначала выберите датасет запроса"
              value={source.column}
              onChange={(e) => onChange({ kind: "csv", column: e.target.value })}
            />
          ))}
      </div>
    </div>
  );
}
