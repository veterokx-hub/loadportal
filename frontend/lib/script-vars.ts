import type { HealthFocus } from "./health-focus";
import type { Param, Scenario } from "./types";

/** Как Gatling сжимает имя перед #{…} и saveAs. */
export function gatlingScriptName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, "");
  if (!cleaned || /^[0-9]/.test(cleaned)) return "v_" + cleaned;
  return cleaned;
}

/** Поле имени переменной: только латинские буквы и цифры. */
export function keepLettersDigits(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, "");
}

export type ScriptVarKind = "column" | "extract" | "counter" | "randomString";

export type ScriptWriter = {
  name: string;
  kind: ScriptVarKind;
  /** Пишет переменную только Gatling. */
  gatlingOnly: boolean;
  label: string;
  datasetName?: string;
  focus: Omit<HealthFocus, "token">;
};

/** Имя параметра становится переменной скрипта у счётчика и, в Gatling, у случайной строки. */
export function paramScriptKind(p: Param): "counter" | "randomString" | null {
  if (p.source.kind !== "generator") return null;
  const t = p.source.generator.type;
  if (t === "counter" || t === "randomString") return t;
  return null;
}

/** Кто создаёт переменную в хотя бы одном скрипте. Корреляция только читает — её здесь нет. */
export function scriptWriters(scenario: Scenario): ScriptWriter[] {
  const out: ScriptWriter[] = [];

  for (const ds of scenario.datasets) {
    const seen = new Set<string>();
    for (const col of ds.columns) {
      const name = col.trim();
      if (!name) continue;
      const again = seen.has(name);
      seen.add(name);
      out.push({
        name,
        kind: "column",
        gatlingOnly: false,
        datasetName: ds.name,
        label: again
          ? `колонка «${name}» датасета «${ds.name}» повторяется`
          : `колонка «${name}» датасета «${ds.name}»`,
        focus: { step: 2, place: "datasets", name: ds.id },
      });
    }
  }

  for (const req of scenario.requests) {
    for (const ex of req.extractions) {
      const name = ex.variable.trim();
      if (!name) continue;
      out.push({
        name,
        kind: "extract",
        gatlingOnly: false,
        label: `извлечение в «${req.name}»`,
        focus: { step: 2, place: "extract", requestId: req.id, name },
      });
    }
    for (const p of req.params) {
      const kind = paramScriptKind(p);
      const name = p.name.trim();
      if (!kind || !name) continue;
      out.push({
        name,
        kind,
        gatlingOnly: kind === "randomString",
        label:
          kind === "counter"
            ? `счётчик «${name}» в «${req.name}»`
            : `случайная строка «${name}» в «${req.name}»`,
        focus: {
          step: 2,
          place: "param",
          requestId: req.id,
          location: p.location,
          name,
        },
      });
    }
  }

  return out;
}

export type ScriptVarClash = {
  name: string;
  gatlingOnly: boolean;
  writers: ScriptWriter[];
};

export function scriptVarClashes(writers: ScriptWriter[]): ScriptVarClash[] {
  const by = new Map<string, ScriptWriter[]>();
  for (const w of writers) {
    const list = by.get(w.name) ?? [];
    list.push(w);
    by.set(w.name, list);
  }
  const out: ScriptVarClash[] = [];
  for (const [name, list] of by) {
    if (list.length < 2) continue;
    const solid = list.filter((w) => !w.gatlingOnly).length;
    out.push({ name, writers: list, gatlingOnly: solid < 2 });
  }
  return out;
}

export function clashMessage(c: ScriptVarClash): string {
  if (c.writers.every((w) => w.kind === "column")) {
    const sets = [...new Set(c.writers.map((w) => w.datasetName ?? ""))];
    if (sets.length === 1) {
      return `В датасете «${sets[0]}» колонка ${c.name} повторяется. В скрипте останется одно значение`;
    }
    const names = sets.map((s) => `«${s}»`).join(", ");
    return `Колонка ${c.name} есть в датасетах ${names}. Если они попадут в одну группу, JMeter и Gatling оставят одно значение`;
  }
  const list = c.writers.map((w) => w.label).join(", ");
  const mark = c.gatlingOnly ? " (Gatling)" : "";
  return `Переменная ${c.name} задаётся несколько раз: ${list}. В скрипте останется одно значение${mark}`;
}

export function clashHint(c: ScriptVarClash): string {
  if (c.gatlingOnly) return "Случайная строка создаёт переменную только в Gatling";
  if (c.writers.every((w) => w.kind === "column")) {
    return "Колонка датасета сразу становится переменной скрипта, даже если её ещё не выбрали в параметре";
  }
  return "Одно имя — одна переменная скрипта. Корреляция это имя только читает";
}
