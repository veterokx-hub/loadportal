"use client";

import type { GeneratorType, ParamSource } from "@/lib/types";

const GENERATORS: { value: GeneratorType; label: string }[] = [
  { value: "uuid", label: "UUID" },
  { value: "randomInt", label: "Случайное число" },
  { value: "randomString", label: "Случайная строка" },
  { value: "counter", label: "Счётчик" },
  { value: "timestamp", label: "Метка времени" },
];

const KIND_LABEL: Record<ParamSource["kind"], string> = {
  constant: "Константа",
  generator: "Генератор",
  correlation: "Корреляция",
  csv: "CSV",
};

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
              className="wide"
              value={source.generator.type}
              onChange={(e) =>
                onChange({
                  kind: "generator",
                  generator: { ...source.generator, type: e.target.value as GeneratorType },
                })
              }
            >
              {GENERATORS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
            {source.generator.type === "randomInt" && (
              <>
                <input
                  className="narrow"
                  type="number"
                  placeholder="min"
                  value={source.generator.min ?? ""}
                  onChange={(e) =>
                    onChange({
                      kind: "generator",
                      generator: { ...source.generator, min: Number(e.target.value) },
                    })
                  }
                />
                <input
                  className="narrow"
                  type="number"
                  placeholder="max"
                  value={source.generator.max ?? ""}
                  onChange={(e) =>
                    onChange({
                      kind: "generator",
                      generator: { ...source.generator, max: Number(e.target.value) },
                    })
                  }
                />
              </>
            )}
            {source.generator.type === "randomString" && (
              <input
                className="narrow"
                type="number"
                placeholder="длина"
                value={source.generator.length ?? ""}
                onChange={(e) =>
                  onChange({
                    kind: "generator",
                    generator: { ...source.generator, length: Number(e.target.value) },
                  })
                }
              />
            )}
            {source.generator.type === "timestamp" && (
              <select
                className="wide"
                value={source.generator.format ?? ""}
                onChange={(e) =>
                  onChange({
                    kind: "generator",
                    generator: { ...source.generator, format: e.target.value },
                  })
                }
              >
                <option value="">мс (Unix)</option>
                <option value="yyyy-MM-dd">yyyy-MM-dd</option>
                <option value="yyyy-MM-dd'T'HH:mm:ss">yyyy-MM-dd&apos;T&apos;HH:mm:ss</option>
                <option value="dd.MM.yyyy HH:mm:ss">dd.MM.yyyy HH:mm:ss</option>
                <option value="yyyyMMddHHmmss">yyyyMMddHHmmss</option>
              </select>
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
