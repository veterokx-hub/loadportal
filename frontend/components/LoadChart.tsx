"use client";

import { useState } from "react";
import type { ProfilePoint } from "@/lib/profile";

export interface Series {
  label: string;
  color: string;
  points: ProfilePoint[];
}

function rpsAt(points: ProfilePoint[], t: number): number {
  if (points.length === 0) return 0;
  if (t <= points[0].t) return points[0].rps;
  for (let i = 1; i < points.length; i++) {
    if (t <= points[i].t) {
      const a = points[i - 1];
      const b = points[i];
      if (b.t === a.t) return b.rps;
      const k = (t - a.t) / (b.t - a.t);
      return a.rps + k * (b.rps - a.rps);
    }
  }
  return points[points.length - 1].rps;
}

/** Монотонная кубическая интерполяция (Fritsch–Carlson): текучая кривая без
 *  выбросов ниже данных — «органический» стиль. Точки со строго растущим x. */
function fluidPath(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M ${pts[0].x} ${pts[0].y}`;

  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const d = pts[i + 1].x - pts[i].x || 1e-6;
    dx.push(d);
    slope.push((pts[i + 1].y - pts[i].y) / d);
  }

  const m: number[] = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) m[i] = 0;
    else m[i] = (slope[i - 1] + slope[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const a = m[i] / slope[i];
      const b = m[i + 1] / slope[i];
      const s = a * a + b * b;
      if (s > 9) {
        const tau = 3 / Math.sqrt(s);
        m[i] = tau * a * slope[i];
        m[i + 1] = tau * b * slope[i];
      }
    }
  }

  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const x1 = pts[i].x + dx[i] / 3;
    const y1 = pts[i].y + (m[i] * dx[i]) / 3;
    const x2 = pts[i + 1].x - dx[i] / 3;
    const y2 = pts[i + 1].y - (m[i + 1] * dx[i]) / 3;
    d += ` C ${x1.toFixed(2)} ${y1.toFixed(2)}, ${x2.toFixed(2)} ${y2.toFixed(2)}, ${pts[
      i + 1
    ].x.toFixed(2)} ${pts[i + 1].y.toFixed(2)}`;
  }
  return d;
}

export function LoadChart({ series }: { series: Series[] }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [isolated, setIsolated] = useState<string | null>(null);

  const totalActive = hovered === TOTAL_LABEL || isolated === TOTAL_LABEL;

  const W = 620;
  const H = 300;
  const padL = 48;
  const padB = 34;
  const padT = 18;
  const padR = 14;

  const maxT = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.t)));

  // равномерная выборка — строго растущий x для гладкой кривой
  const SAMPLES = 120;
  const sample = (pts: ProfilePoint[]): ProfilePoint[] => {
    const out: ProfilePoint[] = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const t = (maxT * i) / SAMPLES;
      out.push({ t, rps: rpsAt(pts, t) });
    }
    return out;
  };

  const totalPts: ProfilePoint[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = (maxT * i) / SAMPLES;
    const rps = series.reduce((acc, s) => acc + rpsAt(s.points, t), 0);
    totalPts.push({ t, rps });
  }

  const showTotal = isolated === null || isolated === TOTAL_LABEL;
  const visible =
    isolated && isolated !== TOTAL_LABEL
      ? series.filter((s) => s.label === isolated)
      : isolated === TOTAL_LABEL
        ? []
        : series;
  const maxRps = showTotal
    ? Math.max(1, ...totalPts.map((p) => p.rps))
    : Math.max(1, ...visible.flatMap((s) => s.points.map((p) => p.rps)));

  const x = (t: number) => padL + (t / maxT) * (W - padL - padR);
  const y = (r: number) => H - padB - (r / maxRps) * (H - padT - padB);

  const curve = (pts: ProfilePoint[]) =>
    fluidPath(sample(pts).map((p) => ({ x: x(p.t), y: y(p.rps) })));

  const totalCurve = fluidPath(totalPts.map((p) => ({ x: x(p.t), y: y(p.rps) })));

  const yTicks = 4;
  const xTicks = 4;

  const endT = maxT;
  const endRps = showTotal ? totalPts[totalPts.length - 1].rps : visible[0]?.points.slice(-1)[0]?.rps ?? 0;

  return (
    <div className="chart-inner">
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Профиль нагрузки"
        onMouseLeave={() => setHovered(null)}
      >
        <defs>
          <linearGradient id="ltpFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.4" />
            <stop offset="55%" stopColor="var(--accent-2)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id="ltpStroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--accent)" />
            <stop offset="55%" stopColor="var(--accent-2)" />
            <stop offset="100%" stopColor="var(--neon)" />
          </linearGradient>
          <filter id="ltpGlow" x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur stdDeviation="3.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* мягкая пунктирная сетка */}
        {Array.from({ length: yTicks + 1 }).map((_, i) => {
          const r = (maxRps * i) / yTicks;
          const yy = y(r);
          return (
            <g key={`y${i}`}>
              <line
                x1={padL}
                y1={yy}
                x2={W - padR}
                y2={yy}
                stroke="var(--border)"
                strokeWidth={1}
                strokeDasharray="1 6"
                strokeLinecap="round"
                opacity={0.7}
              />
              <text x={padL - 8} y={yy + 4} textAnchor="end" fontSize={10} fill="var(--muted)">
                {r.toFixed(r < 10 ? 1 : 0)}
              </text>
            </g>
          );
        })}
        {Array.from({ length: xTicks + 1 }).map((_, i) => {
          const t = (maxT * i) / xTicks;
          return (
            <text key={`x${i}`} x={x(t)} y={H - padB + 16} textAnchor="middle" fontSize={10} fill="var(--muted)">
              {Math.round(t)}с
            </text>
          );
        })}

        {/* суммарная текучая кривая */}
        {showTotal && (
          <>
            <path
              d={`${totalCurve} L ${x(maxT).toFixed(2)} ${y(0).toFixed(2)} L ${x(0).toFixed(2)} ${y(0).toFixed(2)} Z`}
              fill="url(#ltpFill)"
              opacity={hovered && hovered !== TOTAL_LABEL ? 0.4 : 1}
              style={{ transition: "d 0.5s cubic-bezier(.4,0,.2,1), opacity 0.25s ease", cursor: "pointer" }}
              onMouseEnter={() => setHovered(TOTAL_LABEL)}
              onClick={() => setIsolated(isolated === TOTAL_LABEL ? null : TOTAL_LABEL)}
            />
            <path
              d={totalCurve}
              fill="none"
              stroke="url(#ltpStroke)"
              strokeWidth={totalActive ? 3.8 : 3.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              filter="url(#ltpGlow)"
              opacity={hovered && hovered !== TOTAL_LABEL && hovered !== null ? 0.45 : 1}
              style={{ transition: "d 0.5s cubic-bezier(.4,0,.2,1), opacity 0.25s ease", pointerEvents: "none" }}
            >
              <animate attributeName="opacity" values="1;0.82;1" dur="4s" repeatCount="indefinite" />
            </path>
            {/* невидимая зона наведения по суммарной линии */}
            <path
              d={totalCurve}
              fill="none"
              stroke="transparent"
              strokeWidth={14}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHovered(TOTAL_LABEL)}
              onClick={() => setIsolated(isolated === TOTAL_LABEL ? null : TOTAL_LABEL)}
            />
            {/* пульсирующий маркер текущего значения */}
            <circle cx={x(endT)} cy={y(endRps)} r={4.5} fill="var(--neon)" filter="url(#ltpGlow)">
              <animate attributeName="r" values="4;6;4" dur="2.6s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="1;0.6;1" dur="2.6s" repeatCount="indefinite" />
            </circle>
          </>
        )}

        {/* линии групп */}
        {visible.map((s) => {
          const active = hovered === s.label || isolated === s.label;
          const dimmed =
            (hovered !== null && hovered !== s.label && hovered !== TOTAL_LABEL) ||
            (isolated !== null && isolated !== s.label && isolated !== TOTAL_LABEL);
          const d = curve(s.points);
          return (
            <g key={s.label}>
              <path
                d={d}
                fill="none"
                stroke="transparent"
                strokeWidth={14}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHovered(s.label)}
                onClick={() => setIsolated(isolated === s.label ? null : s.label)}
              />
              <path
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth={active ? 3.4 : 2}
                strokeLinecap="round"
                strokeLinejoin="round"
                filter={active ? "url(#ltpGlow)" : undefined}
                opacity={dimmed ? 0.18 : active ? 1 : 0.85}
                style={{ transition: "d 0.5s cubic-bezier(.4,0,.2,1), opacity 0.2s ease, stroke-width 0.15s ease", pointerEvents: "none" }}
              />
            </g>
          );
        })}

        <text x={padL} y={12} fontSize={10} fill="var(--muted)">RPS</text>
        <text x={W - padR} y={H - 2} fontSize={10} fill="var(--muted)" textAnchor="end">время</text>
      </svg>

      <div className="legend">
        {showTotal && (
          <span
            className="item legend-total"
            title={TOTAL_LABEL}
            onMouseEnter={() => setHovered(TOTAL_LABEL)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => setIsolated(isolated === TOTAL_LABEL ? null : TOTAL_LABEL)}
            style={{
              cursor: "pointer",
              fontWeight: totalActive ? 700 : 400,
              opacity:
                isolated !== null && isolated !== TOTAL_LABEL
                  ? 0.4
                  : hovered !== null && hovered !== TOTAL_LABEL
                    ? 0.5
                    : 1,
              textDecoration: isolated === TOTAL_LABEL ? "underline" : "none",
            }}
          >
            <span
              className="swatch swatch-total"
              style={{
                background: "linear-gradient(90deg, var(--accent), var(--neon))",
                outline: totalActive ? "2px solid var(--accent)" : "none",
                outlineOffset: 1,
              }}
            />
            {TOTAL_LABEL}
          </span>
        )}
        {series.map((s) => {
          const active = hovered === s.label || isolated === s.label;
          const dimmed =
            (isolated !== null && isolated !== s.label && isolated !== TOTAL_LABEL) ||
            (isolated === null && hovered !== null && hovered !== s.label && hovered !== TOTAL_LABEL);
          const short =
            s.label.length > 42 ? s.label.slice(0, 40) + "…" : s.label;
          return (
            <span
              className="item"
              key={s.label}
              onMouseEnter={() => setHovered(s.label)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => setIsolated(isolated === s.label ? null : s.label)}
              style={{
                cursor: "pointer",
                fontWeight: active ? 700 : 400,
                opacity: dimmed ? 0.4 : 1,
                textDecoration: isolated === s.label ? "underline" : "none",
              }}
              title={`${s.label}\nНаведите — подсветить; клик — показать только этот запрос`}
            >
              <span
                className="swatch"
                style={{
                  background: s.color,
                  outline: active ? `2px solid ${s.color}` : "none",
                  outlineOffset: 1,
                  flexShrink: 0,
                }}
              />
              <span className="legend-text">{short}</span>
            </span>
          );
        })}
        {isolated && (
          <button className="ghost small" onClick={() => setIsolated(null)} style={{ marginLeft: 8 }}>
            показать все
          </button>
        )}
      </div>
    </div>
  );
}

export const CHART_COLORS = [
  "#5b7cff",
  "#2fe6e0",
  "#b45bff",
  "#ff5ea8",
  "#37e6a8",
  "#ffb454",
];

export const TOTAL_LABEL = "Суммарная интенсивность";
