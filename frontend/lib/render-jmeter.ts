import type { Generator, ParamSource } from "./types";

/** Преобразует ParamSource в JMeter-выражение (${var}, ${__UUID()} и т.д.). */
export function paramSourceToJmeter(source: ParamSource): string {
  switch (source.kind) {
    case "constant":
      return source.value;
    case "correlation":
      return `\${${source.variable}}`;
    case "csv":
      return `\${${source.column}}`;
    case "generator":
      return generatorToJmeter(source.generator);
  }
}

function generatorToJmeter(g: Generator): string {
  switch (g.type) {
    case "uuid":
      return "${__UUID()}";
    case "randomInt":
      return `\${__Random(${g.min ?? 0},${g.max ?? 1000000})}`;
    case "randomString":
      return `\${__RandomString(${g.length ?? 8},${g.chars ?? "abcdefghijklmnopqrstuvwxyz0123456789"})}`;
    case "counter":
      return "${__counter(FALSE)}";
    case "timestamp":
      return g.format ? `\${__time(${g.format})}` : "${__time()}";
  }
}

/** Угадывает ParamSource из сохранённого JMeter-значения заголовка. */
export function jmeterToParamSource(value: string): ParamSource {
  const v = value ?? "";
  if (v === "${__UUID()}") return { kind: "generator", generator: { type: "uuid" } };
  const ri = v.match(/^\$\{__Random\((\d+),(\d+)\)\}$/);
  if (ri) return { kind: "generator", generator: { type: "randomInt", min: +ri[1], max: +ri[2] } };
  const rs = v.match(/^\$\{__RandomString\((\d+)(?:,(.*))?\)\}$/);
  if (rs) return { kind: "generator", generator: { type: "randomString", length: +rs[1], chars: rs[2] } };
  if (v.startsWith("${__counter")) return { kind: "generator", generator: { type: "counter" } };
  const tm = v.match(/^\$\{__time\((.*)\)\}$/);
  if (tm) return { kind: "generator", generator: { type: "timestamp", format: tm[1] } };
  if (v === "${__time()}") return { kind: "generator", generator: { type: "timestamp" } };
  const cv = v.match(/^\$\{([a-zA-Z0-9_]+)\}$/);
  if (cv) return { kind: "correlation", variable: cv[1] };
  return { kind: "constant", value: v };
}
