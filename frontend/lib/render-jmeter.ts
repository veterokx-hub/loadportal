import type { ParamSource } from "./types";

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
