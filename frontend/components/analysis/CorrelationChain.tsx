"use client";

import { SEVERITY_META, type Correlation, type Finding } from "@/lib/analysis";

/**
 * Цепочка «причина → следствие» в терминах метрик.
 *
 * Пять находок, пришедших от одной причины, читаются как пять проблем. Цепочка
 * превращает их обратно в одну: слева то, что сломалось, справа то, что от этого
 * пострадало. Порядок задан сервером — здесь только отрисовка.
 */
export function CorrelationChain({
  correlation,
  findings,
  onPickFinding,
}: {
  correlation: Correlation;
  findings: Finding[];
  onPickFinding?: (id: string) => void;
}) {
  const tone = SEVERITY_META[correlation.severity].tone;
  const members = correlation.finding_ids
    .map((id) => findings.find((f) => f.id === id))
    .filter((f): f is Finding => Boolean(f));

  return (
    <article className={`chain-card tone-${tone}`}>
      <header className="chain-head">
        <h4>{correlation.title}</h4>
        <span className="tag" title="Насколько согласованы находки по времени и связям каталога">
          связность {correlation.confidence}%
        </span>
      </header>

      <p className="chain-summary">{correlation.summary}</p>

      <div className="chain-flow">
        {/* Стрелка стоит перед узлом, а не после: при переносе строки она уходит на новую
            строку вместе со своим звеном, а не остаётся висеть в конце предыдущей. */}
        {members.map((finding, i) => (
          <div className="chain-seg" key={finding.id}>
            {i > 0 && (
              <span className="chain-arrow" aria-hidden>
                →
              </span>
            )}
            <button
              type="button"
              className={`chain-node sev-${SEVERITY_META[finding.severity].tone}`}
              onClick={() => onPickFinding?.(finding.id)}
              title={finding.summary}
            >
              <span className="chain-node-name">{finding.metric_title}</span>
              <span className="chain-node-role">{i === 0 ? "причина" : "следствие"}</span>
            </button>
          </div>
        ))}
      </div>
    </article>
  );
}
