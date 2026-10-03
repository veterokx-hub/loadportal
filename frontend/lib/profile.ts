import type { Intensity, LoadConfig, RequestModel } from "./types";

/** HTTP-сэмплов за одну итерацию группы (сумма repeat). */
export function samplesPerIteration(requests: Pick<RequestModel, "repeat">[]): number {
  return Math.max(
    1,
    requests.reduce((n, r) => n + Math.max(1, r.repeat), 0)
  );
}

/** k6 arrival-rate: старты exec/с, чтобы суммарный HTTP RPS = target. */
export function arrivalRate(httpRps: number, samples: number): number {
  const http = Math.max(0, httpRps);
  const n = Math.max(1, samples);
  return n === 1 ? http : http / n;
}

/** Доля HTTP RPS запроса внутри группы (как TST: пропорционально repeat). */
export function requestShareRps(groupHttpRps: number, repeat: number, samples: number): number {
  return samples > 0 ? (Math.max(0, groupHttpRps) * Math.max(1, repeat)) / samples : 0;
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
