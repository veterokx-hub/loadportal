"use client";

import { useMemo } from "react";
import {
  PHASE_META,
  SEVERITY_META,
  formatDurationSec,
  type Finding,
  type Phase,
} from "@/lib/analysis";

/** Ниже этой доли ширины подпись фазы не влезает целиком. */
const LABEL_MIN_PCT = 9;
/** Засечки в пределах этой доли ширины считаются совпавшими. */
const PIN_BUCKET_PCT = 1.5;
const PIN_STEP_PX = 22;

/**
 * Полоса фаз теста с засечками находок.
 *
 * Отвечает на вопрос, которого нет ни на одном стандартном дашборде: «когда
 * началось». Проблема на прогреве и проблема через сорок минут плато — разные
 * диагнозы, а на обычном графике за сутки они выглядят одинаково.
 */
export function PhaseTimeline({
  phases,
  findings,
  onPick,
  activeId,
}: {
  phases: Phase[];
  findings: Finding[];
  onPick?: (findingId: string) => void;
  activeId?: string | null;
}) {
  const bounds = useMemo(() => {
    if (phases.length === 0) return null;
    const from = new Date(phases[0].from_ts).getTime();
    const to = new Date(phases[phases.length - 1].to_ts).getTime();
    return { from, span: Math.max(1, to - from) };
  }, [phases]);

  if (!bounds || phases.length === 0) return null;

  const pos = (iso: string) => ((new Date(iso).getTime() - bounds.from) / bounds.span) * 100;

  /**
   * Дрейф у всех метрик начинается в одной точке — на старте плато, — и засечки
   * ложатся друг на друга: вместо шести находок видно одну, и до нижних не дотянуться
   * курсором. Совпадающие раздвигаются веером; у правого края — в обратную сторону,
   * иначе уезжают за пределы полосы.
   */
  const seen = new Map<number, number>();
  const pins = findings.map((finding) => {
    const left = Math.max(0, Math.min(100, pos(finding.from_ts)));
    const bucket = Math.round(left / PIN_BUCKET_PCT);
    const order = seen.get(bucket) ?? 0;
    seen.set(bucket, order + 1);
    return { finding, left, nudge: order * PIN_STEP_PX * (left > 50 ? -1 : 1) };
  });

  return (
    <div className="phase-timeline">
      <div className="phase-labels" aria-hidden>
        {phases.map((phase, i) => {
          const left = pos(phase.from_ts);
          const width = Math.max(0.6, pos(phase.to_ts) - left);
          if (width < LABEL_MIN_PCT) return null;
          return (
            <span
              key={`label-${phase.kind}-${i}`}
              className={`phase-seg-label ${phase.excluded ? "excluded" : ""}`}
              style={{ left: `${left}%`, width: `${width}%` }}
            >
              {PHASE_META[phase.kind].label}
            </span>
          );
        })}
      </div>

      <div className="phase-bar">
        {phases.map((phase, i) => {
          const left = pos(phase.from_ts);
          const width = Math.max(0.6, pos(phase.to_ts) - left);
          const meta = PHASE_META[phase.kind];
          const sec = (new Date(phase.to_ts).getTime() - new Date(phase.from_ts).getTime()) / 1000;
          return (
            <div
              key={`${phase.kind}-${i}`}
              className={`phase-seg phase-${phase.kind} ${phase.excluded ? "excluded" : ""}`}
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`${meta.label} · ${formatDurationSec(sec)}${
                phase.rps > 0 ? ` · ~${Math.round(phase.rps)} rps` : ""
              }\n${meta.hint}${phase.excluded ? "\nФаза исключена из выводов." : ""}`}
            />
          );
        })}
      </div>

      <div className="phase-pins">
        {pins.map(({ finding, left, nudge }) => (
          <button
            type="button"
            key={finding.id}
            className={`phase-pin sev-${SEVERITY_META[finding.severity].tone} ${
              activeId === finding.id ? "active" : ""
            }`}
            style={{ left: `${left}%`, ["--pin-nudge" as string]: `${nudge}px` }}
            onClick={() => onPick?.(finding.id)}
            title={`${finding.metric_title}: ${finding.title}`}
            aria-label={`${finding.metric_title}: ${finding.title}`}
          />
        ))}
      </div>

      <div className="phase-axis">
        <span>{new Date(phases[0].from_ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</span>
        <span className="muted">
          длительность {formatDurationSec(bounds.span / 1000)}
        </span>
        <span>
          {new Date(phases[phases.length - 1].to_ts).toLocaleTimeString("ru-RU", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
    </div>
  );
}
