import type { Param, ParamLocation, RequestModel } from "./types";
import { jmeterToParamSource } from "./render-jmeter";

/** Типы параметров, добавляемые вручную на шаге «Корреляция». */
export const PARAM_UI_LOCATIONS: ParamLocation[] = ["header", "query", "body"];

export const PARAM_LOCATION_LABEL: Record<string, string> = {
  header: "Header",
  path: "Path",
  query: "Query",
  body: "Body",
};

/** Имена в фигурных скобках {name}. */
export function bracesIn(text: string): string[] {
  const out: string[] = [];
  const re = /\{([a-zA-Z0-9_]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

function pathTemplateHas(req: RequestModel, name: string): boolean {
  return (req.path ?? "").includes(`{${name}}`);
}

/**
 * Синхронизирует path-параметры с шаблоном URL ({id}).
 * Добавляет недостающие; path без {name} в URL → query.
 * Header / query / body не трогает (кроме совпадения имени с path).
 */
export function ensurePathParams(req: RequestModel): RequestModel {
  const pathNames = bracesIn(req.path ?? "");
  const pathSet = new Set(pathNames);
  let params = [...req.params];

  for (const name of pathNames) {
    const pathIdx = params.findIndex((p) => p.location === "path" && p.name === name);
    if (pathIdx >= 0) continue;
    const otherIdx = params.findIndex((p) => p.name === name);
    if (otherIdx >= 0) {
      params[otherIdx] = { ...params[otherIdx], location: "path", required: true };
    } else {
      params.push({
        name,
        location: "path",
        source: { kind: "constant", value: "" },
        required: true,
      });
    }
  }

  params = params.map((p) => {
    if (p.location === "path" && !pathSet.has(p.name)) {
      return { ...p, location: "query" as ParamLocation };
    }
    return p;
  });

  return { ...req, params };
}

/** Path из шаблона URL + Header / Query / Body. */
export function uiParams(req: RequestModel): Param[] {
  return req.params.filter((p) => {
    if (p.location === "header" || p.location === "query" || p.location === "body") {
      return true;
    }
    if (p.location === "path" && pathTemplateHas(req, p.name)) {
      return true;
    }
    return false;
  });
}

/** Переносит headers[] в params, синхронизирует path из URL. */
export function consolidateRequestParams(req: RequestModel): RequestModel {
  const withPath = ensurePathParams(req);
  const params = [...withPath.params];
  const keys = new Set(params.map((p) => `${p.location}:${p.name}`));

  for (const h of req.headers) {
    if (!h.key) continue;
    const k = `header:${h.key}`;
    if (keys.has(k)) continue;
    params.push({
      name: h.key,
      location: "header",
      source: jmeterToParamSource(h.value),
      required: false,
    });
    keys.add(k);
  }

  const deduped: Param[] = [];
  const seen = new Set<string>();
  for (const p of params) {
    const k = `${p.location}:${p.name}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(p);
  }

  return { ...withPath, headers: [], params: deduped };
}

export function uiParamIndex(req: RequestModel, p: Param): number {
  return req.params.indexOf(p);
}
