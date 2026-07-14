import type { Intensity, LoadConfig } from "./types";

export interface ProfilePoint {
  t: number; // сек
  rps: number;
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
