"use client";

import { useState, type MouseEvent } from "react";
import { formatValue, type Spark } from "@/lib/analysis";

/**
 * Мини-график находки. Смысл — не заменить Grafana, а показать форму кривой
 * рядом с текстом: «ползёт вверх» и «дёрнулось один раз» выглядят по-разному,
 * и человеку не нужно верить формулировке на слово.
 */
export function Sparkline({
  spark,
  tone = "warn",
  height = 64,
}: {
  spark: Spark;
  tone?: string;
  height?: number;
}) {
  const [tip, setTip] = useState<{ x: number; label: string } | null>(null);

  const points = spark.t.length;
  if (points < 2) {
    return <div className="spark-empty">ряд слишком короткий для графика</div>;
  }

  const W = 320;
  const H = height;
  const padT = 8;
  const padB = 8;

  const t0 = spark.t[0];
  const span = spark.t[points - 1] - t0 || 1;

  const num = (g: unknown): g is number => typeof g === "number" && Number.isFinite(g);
  const limit = num(spark.limit) ? spark.limit : null;
  /**
   * У находки по правилу база и порог — одно и то же число: сравнивать наблюдаемое
   * там не с чем, кроме порога. Две пунктирных линии тогда ложатся друг на друга,
   * а легенда читается как «база 0 · порог 0» — будто это разные величины.
   */
  const baseline = num(spark.baseline) && spark.baseline !== limit ? spark.baseline : null;
  const values = [...spark.v, ...[baseline, limit].filter(num)];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  // Плоский ряд без запаса превратился бы в линию по краю поля.
  const pad = hi - lo > 0 ? (hi - lo) * 0.12 : Math.max(Math.abs(hi) * 0.1, 1);
  const min = lo - pad;
  const max = hi + pad;

  const x = (ts: number) => ((ts - t0) / span) * W;
  const y = (v: number) => H - padB - ((v - min) / (max - min || 1)) * (H - padT - padB);

  const line = spark.v.map((v, i) => `${i === 0 ? "M" : "L"} ${x(spark.t[i]).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L ${W} ${H - padB} L 0 ${H - padB} Z`;
  const gradientId = `spark-${tone}`;

  function hover(e: MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const idx = Math.max(0, Math.min(points - 1, Math.round(ratio * (points - 1))));
    const at = new Date(spark.t[idx] * 1000).toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    });
    setTip({
      x: Math.min(92, Math.max(8, ratio * 100)),
      label: `${at} · ${formatValue(spark.v[idx], spark.unit)}`,
    });
  }

  return (
    <div className={`spark tone-${tone}`}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        role="img"
        aria-label="Динамика метрики"
        onMouseMove={hover}
        onMouseLeave={() => setTip(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.32" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {baseline !== null && (
          <line
            x1={0}
            x2={W}
            y1={y(baseline)}
            y2={y(baseline)}
            stroke="var(--muted)"
            strokeWidth={1}
            strokeDasharray="4 5"
            opacity={0.7}
          />
        )}
        {limit !== null && (
          <line
            x1={0}
            x2={W}
            y1={y(limit)}
            y2={y(limit)}
            stroke="var(--danger)"
            strokeWidth={1}
            strokeDasharray="2 3"
            opacity={0.85}
          />
        )}

        <path d={area} fill={`url(#${gradientId})`} />
        <path
          d={line}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={x(spark.t[points - 1])} cy={y(spark.v[points - 1])} r={2.6} fill="currentColor" />
      </svg>

      <div className="spark-scale">
        <span title="Минимум на графике">{formatValue(lo, spark.unit)}</span>
        {baseline !== null && (
          <span className="spark-legend" title="Медиана до отклонения">
            база {formatValue(baseline, spark.unit)}
          </span>
        )}
        {limit !== null && (
          <span className="spark-legend spark-legend-limit" title="Порог правила или лимит контейнера">
            порог {formatValue(limit, spark.unit)}
          </span>
        )}
      </div>

      {tip && (
        <div className="spark-tip" style={{ left: `${tip.x}%` }}>
          {tip.label}
        </div>
      )}
    </div>
  );
}
