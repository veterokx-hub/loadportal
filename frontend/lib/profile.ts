import { groupRequests } from "./grouping";
import type { Intensity, LoadConfig, RequestModel, Scenario } from "./types";

/** Процент выполнений запроса: 1..100. Пустое значение — 100. */
export function throughputPercent(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 100;
  return Math.min(100, Math.max(1, Math.round(value)));
}

/**
 * Доля итерации каждого запроса (0..1).
 * Один запрос в группе всегда 1: процент имеет смысл только для выравнивания внутри группы.
 * Старые сборки без throughput: доля = repeat / max(repeat), максимум становится 100%.
 */
export function iterationWeights(
  requests: Pick<RequestModel, "throughput" | "repeat">[]
): number[] {
  if (requests.length < 2) return requests.map(() => 1);
  const explicit = requests.some((r) => r.throughput != null && Number.isFinite(r.throughput));
  if (explicit) {
    return requests.map((r) =>
      r.throughput != null && Number.isFinite(r.throughput) ? throughputPercent(r.throughput) / 100 : 1
    );
  }
  const top = Math.max(1, ...requests.map((r) => Math.max(1, r.repeat || 1)));
  return requests.map(
    (r) => Math.max(1, Math.min(100, Math.round((100 * Math.max(1, r.repeat || 1)) / top))) / 100
  );
}

/** Ожидаемое число HTTP-сэмплов за итерацию группы (сумма долей). */
export function samplesPerIteration(
  requests: Pick<RequestModel, "throughput" | "repeat">[]
): number {
  const sum = iterationWeights(requests).reduce((n, w) => n + w, 0);
  return sum > 0 ? sum : 1;
}

/** Проставляет throughput и гасит старый repeat, чтобы генераторы не читали его как цикл. */
export function withThroughput(scenario: Scenario): RequestModel[] {
  const groups = groupRequests(scenario);
  const pct = new Map<string, number>();
  for (const g of groups) {
    if (g.requests.length < 2) {
      for (const r of g.requests) pct.set(r.id, throughputPercent(r.throughput));
      continue;
    }
    iterationWeights(g.requests).forEach((w, i) => {
      pct.set(g.requests[i].id, Math.round(w * 100));
    });
  }
  return scenario.requests.map((r) => ({
    ...r,
    throughput: pct.get(r.id) ?? throughputPercent(r.throughput),
    repeat: 1,
  }));
}

/** k6/Gatling: старты итераций/с, чтобы суммарный HTTP RPS = target. samples — сумма долей. */
export function arrivalRate(httpRps: number, samples: number): number {
  const http = Math.max(0, httpRps);
  return samples > 0 ? http / samples : 0;
}

/** Доля HTTP RPS запроса внутри группы: пропорционально проценту выполнений. */
export function requestShareRps(groupHttpRps: number, percent: number, samples: number): number {
  if (!(samples > 0)) return 0;
  return (Math.max(0, groupHttpRps) * (Math.max(0, percent) / 100)) / samples;
}

export interface ProfilePoint {
  t: number; // сек
  rps: number;
}

/** Формат RPS для UI: 0.01 не превращается в «0» / «0.0». */
export function formatRps(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 10) return n.toFixed(0);
  if (abs >= 1) return trimFloat(n.toFixed(1));
  if (abs >= 0.01) return trimFloat(n.toFixed(2));
  return trimFloat(n.toFixed(3));
}

function trimFloat(s: string): string {
  return s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

/**
 * Профиль интенсивности одной группы во времени — зеркало логики Throughput
 * Shaping Timer в JmxBuilder.
 */
export function groupProfile(intensity: Intensity, load: LoadConfig): ProfilePoint[] {
  const target = Math.max(0, intensity.target_rps);
  const pts: ProfilePoint[] = [];

  if (load.test_mode === "max_search") {
    const steps = Math.max(1, load.steps);
    const dur = Math.max(1, load.step_duration_sec);
    let t = 0;
    for (let i = 1; i <= steps; i++) {
      const level = (target * i) / steps;
      pts.push({ t, rps: level });
      t += dur;
      pts.push({ t, rps: level });
    }
  } else {
    let t = 0;
    if (intensity.ramp_up_sec > 0) {
      const start = Math.min(1, target);
      pts.push({ t: 0, rps: start });
      t = intensity.ramp_up_sec;
      pts.push({ t, rps: target });
    } else {
      pts.push({ t: 0, rps: target });
    }
    t += Math.max(1, intensity.hold_sec);
    pts.push({ t, rps: target });
  }
  return pts;
}

export function totalDuration(intensity: Intensity, load: LoadConfig): number {
  if (load.test_mode === "max_search") {
    return Math.max(1, load.steps) * Math.max(1, load.step_duration_sec);
  }
  return Math.max(0, intensity.ramp_up_sec) + Math.max(1, intensity.hold_sec);
}
