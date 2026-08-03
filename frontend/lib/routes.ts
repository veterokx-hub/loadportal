import type { AppModuleId } from "./modules";

/** Шаги модуля «Сценарий» → сегмент URL */
export const SCENARIO_STEPS = [
  { slug: "source", label: "Источник", index: 0 },
  { slug: "requests", label: "Запросы", index: 1 },
  { slug: "correlation", label: "Корреляция и параметры", index: 2 },
  { slug: "intensity", label: "Интенсивность и сборка", index: 3 },
] as const;

export type ScenarioStepSlug = (typeof SCENARIO_STEPS)[number]["slug"];

export const MODULE_PATH: Record<AppModuleId, string> = {
  scenario: "/scenario/source",
  environment: "/environment",
  run: "/run/new",
  analysis: "/analysis",
  report: "/report",
};

export function scenarioPath(slug: ScenarioStepSlug | string): string {
  return `/scenario/${slug}`;
}

export function scenarioSlugByIndex(index: number): ScenarioStepSlug {
  return SCENARIO_STEPS[Math.max(0, Math.min(index, SCENARIO_STEPS.length - 1))]!.slug;
}

export function runNewPath(buildId?: string | null): string {
  if (buildId) return `/run/new?build=${encodeURIComponent(buildId)}`;
  return "/run/new";
}

export function runDetailPath(runId: string): string {
  return `/run/${encodeURIComponent(runId)}`;
}

/** Вкладки модуля «Запуск» — зеркало step-pills сценария */
export const RUN_TABS = [
  { id: "new" as const, label: "Новый запуск", href: "/run/new", num: 1 },
  { id: "list" as const, label: "Прогоны", href: "/run/list", num: 2 },
];

export function moduleIdFromPath(pathname: string): AppModuleId {
  if (pathname.startsWith("/scenario")) return "scenario";
  if (pathname.startsWith("/environment")) return "environment";
  if (pathname.startsWith("/run")) return "run";
  if (pathname.startsWith("/analysis")) return "analysis";
  if (pathname.startsWith("/report")) return "report";
  return "scenario";
}
