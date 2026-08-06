import type { Intensity, RequestModel, Scenario } from "./types";

export interface Group {
  key: string;
  requests: RequestModel[];
  datasetIds: string[];
}

/** Интенсивность группы = интенсивность её первого запроса (единая на группу). */
export function groupIntensity(g: Group): Intensity {
  return g.requests[0].intensity;
}

const VAR_RE = /\$\{([a-zA-Z0-9_]+)\}/g;

function referencedVars(req: RequestModel): Set<string> {
  const vars = new Set<string>();
  const scan = (text?: string | null) => {
    if (!text) return;
    let m: RegExpExecArray | null;
    VAR_RE.lastIndex = 0;
    while ((m = VAR_RE.exec(text)) !== null) vars.add(m[1]);
  };
  req.headers.forEach((h) => scan(h.value));
  req.params.forEach((p) => {
    if (p.source.kind === "correlation") vars.add(p.source.variable);
    else if (p.source.kind === "constant") scan(p.source.value);
  });
  scan(req.body?.content);
  scan(req.path);
  scan(req.url);
  return vars;
}

/** union-find группировка: корреляция (${var} из экстрактора) + общий dataset_id. */
export function groupRequests(scenario: Scenario): Group[] {
  const reqs = [...scenario.requests].sort((a, b) => a.order - b.order);
  if (reqs.length === 0) return [];

  const parent = reqs.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const varOwner = new Map<string, number>();
  reqs.forEach((r, i) =>
    r.extractions.forEach((e) => {
      if (e.variable) varOwner.set(e.variable, i);
    })
  );

  reqs.forEach((r, i) => {
    referencedVars(r).forEach((v) => {
      const owner = varOwner.get(v);
      if (owner !== undefined && owner !== i) union(owner, i);
    });
  });

  const firstByDataset = new Map<string, number>();
  reqs.forEach((r, i) => {
    if (r.dataset_id) {
      const first = firstByDataset.get(r.dataset_id);
      if (first === undefined) firstByDataset.set(r.dataset_id, i);
      else union(first, i);
    }
  });

  const comps = new Map<number, RequestModel[]>();
  reqs.forEach((r, i) => {
    const root = find(i);
    if (!comps.has(root)) comps.set(root, []);
    comps.get(root)!.push(r);
  });

  const groups: Group[] = [];
  comps.forEach((members) => {
    members.sort((a, b) => a.order - b.order);
    const datasetIds = Array.from(
      new Set(members.map((m) => m.dataset_id).filter(Boolean) as string[])
    );
    groups.push({ key: members[0].id, requests: members, datasetIds });
  });
  groups.sort((a, b) => a.requests[0].order - b.requests[0].order);
  return groups;
}

export function groupTitle(g: Group): string {
  if (g.requests.length === 1) return g.requests[0].name;
  return `Связка ×${g.requests.length}: ${g.requests.map((r) => r.name).join(" → ")}`;
}
