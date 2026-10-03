"use client";

import { useState } from "react";
import { SEVERITY_META, type Finding, type Hypothesis } from "@/lib/analysis";

/**
 * Гипотеза — то, ради чего модуль вообще существует.
 *
 * Находка говорит «heap растёт»; гипотеза говорит «похоже на кэш без вытеснения,
 * посмотри туда». Формулировка намеренно осторожная: модуль видит метрики, а не
 * код, и обещать диагноз он не вправе. Уверенность показана числом, чтобы
 * гипотезу с 40 % не читали как приговор.
 */
export function HypothesisCard({
  hypothesis,
  findings,
  index,
  onPickFinding,
}: {
  hypothesis: Hypothesis;
  findings: Finding[];
  index: number;
  onPickFinding?: (id: string) => void;
}) {
  const [open, setOpen] = useState(index === 0);
  const tone = SEVERITY_META[hypothesis.severity].tone;
  const linked = findings.filter((f) => hypothesis.finding_ids.includes(f.id));

  return (
    <article className={`hyp tone-${tone} ${open ? "open" : ""}`}>
      <button type="button" className="hyp-head" onClick={() => setOpen((v) => !v)}>
        <span className="hyp-rank">{index + 1}</span>
        <span className="hyp-title">
          {hypothesis.title}
          <span className="hyp-sub">
            {linked.length > 0
              ? `по ${linked.length} ${plural(linked.length, "находке", "находкам", "находкам")}`
              : "по совокупности метрик"}
          </span>
        </span>
        <span className="hyp-confidence" title="Насколько картина метрик совпала с паттерном">
          <span className="hyp-confidence-bar">
            <span style={{ width: `${Math.max(6, Math.min(100, hypothesis.confidence))}%` }} />
          </span>
          {hypothesis.confidence}%
        </span>
        <span className="pulse-chevron">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="hyp-body">
          <p className="hyp-text">{hypothesis.body}</p>

          {hypothesis.checks.length > 0 && (
            <>
              <h4 className="hyp-checks-title">Куда смотреть в коде</h4>
              <ol className="hyp-checks">
                {hypothesis.checks.map((check, i) => (
                  <li key={i}>{check}</li>
                ))}
              </ol>
            </>
          )}

          {linked.length > 0 && (
            <div className="hyp-links">
              <span className="muted">На чём основано:</span>
              {linked.map((f) => (
                <button
                  type="button"
                  key={f.id}
                  className={`hyp-link sev-${SEVERITY_META[f.severity].tone}`}
                  onClick={() => onPickFinding?.(f.id)}
                >
                  {f.metric_title}
                </button>
              ))}
            </div>
          )}

          <p className="hyp-disclaimer">
            Это гипотеза по форме метрик, а не диагноз. Модуль видит поведение сервиса
            снаружи — подтвердить или опровергнуть можно только в коде.
          </p>
        </div>
      )}
    </article>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
