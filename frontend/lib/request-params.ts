import type { Param, ParamLocation, RequestModel } from "./types";
import { jmeterToParamSource } from "./render-jmeter";

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

/** Шаблон адреса запроса: собственный URL, если задан, иначе path. */
export function urlTemplate(req: Pick<RequestModel, "path" | "url">): string {
  const u = (req.url ?? "").trim();
  return u !== "" ? u : (req.path ?? "");
}

function pathTemplateHas(req: RequestModel, name: string): boolean {
  return urlTemplate(req).includes(`{${name}}`);
}

/**
 * Пересчитывает path/body-параметры из {…} шаблона адреса и тела,
 * сохраняя header/query и уже настроенные источники.
 */
export function paramsFromTemplates(
  template: string,
  body: string,
  existing: Param[]
): Param[] {
  const braceLoc = new Map<string, ParamLocation>();
  bracesIn(template).forEach((n) => braceLoc.set(n, "path"));
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

/**
 * Синхронизирует path-параметры с шаблоном URL ({id}).
 * Добавляет недостающие; path без {name} в URL → query.
 * Header / query / body не трогает (кроме совпадения имени с path).
 */
function ensurePathParams(req: RequestModel): RequestModel {
  const pathNames = bracesIn(urlTemplate(req));
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
