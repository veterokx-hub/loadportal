import { useSyncExternalStore } from "react";
import type { ParamLocation } from "./types";

/** Куда вести из чек-листа «Здоровье сценария». */
export type HealthPlace =
  | "add-request"
  | "base-url"
  | "request-path"
  | "dataset"
  | "datasets"
  | "param"
  | "extract"
  | "body"
  | "intensity"
  | "autostop";

export interface HealthFocus {
  step: number;
  place: HealthPlace;
  requestId?: string;
  location?: ParamLocation;
  name?: string;
  token: number;
}

let focus: HealthFocus | null = null;
let token = 0;
const listeners = new Set<() => void>();

export function healthMark(
  place: HealthPlace,
  requestId = "",
  location = "",
  name = ""
): string {
  return [place, requestId, location, name].join("|");
}

export function setHealthFocus(next: Omit<HealthFocus, "token">) {
  token += 1;
  focus = { ...next, token };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useHealthFocus(): HealthFocus | null {
  return useSyncExternalStore(subscribe, () => focus, () => null);
}

/** Прокрутка к метке и короткая подсветка. Поле внутри получает фокус. */
export function revealHealth(f: HealthFocus) {
  const exact = healthMark(f.place, f.requestId ?? "", f.location ?? "", f.name ?? "");
  const broad = healthMark(f.place, f.requestId ?? "", f.location ?? "", "");
  const el =
    document.querySelector(`[data-health="${CSS.escape(exact)}"]`) ??
    (f.name ? document.querySelector(`[data-health="${CSS.escape(broad)}"]`) : null);
  if (!(el instanceof HTMLElement)) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("health-flash");
  void el.offsetWidth;
  el.classList.add("health-flash");
  const field = el.matches("input, select, textarea")
    ? el
    : el.querySelector("input, select, textarea");
  if (field instanceof HTMLElement) field.focus({ preventScroll: true });
}
