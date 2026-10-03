"use client";

import {
  SEVERITY_META,
  TEST_KIND_META,
  VERDICT_META,
  formatWindow,
  type AnalysisReport,
  type Severity,
} from "@/lib/analysis";

/**
 * Первый экран отчёта: одна фраза и одно число.
 *
 * Смысл модуля в том, чтобы человек, который не умеет читать двадцать графиков,
 * получил вывод текстом. Поэтому заголовок здесь крупнее всего остального,
 * а кольцо оценки — только подпись к нему.
 */
export function VerdictHero({ report }: { report: AnalysisReport }) {
  const meta = VERDICT_META[report.verdict];
  const counts = countBySeverity(report.findings.map((f) => f.severity));
  const score = Math.max(0, Math.min(100, report.health_score));
  const R = 46;
  const circumference = 2 * Math.PI * R;

  return (
    <section className={`verdict tone-${meta.tone}`}>
      <div className="verdict-ring" aria-hidden>
        <svg viewBox="0 0 110 110" width="110" height="110">
          <circle cx="55" cy="55" r={R} fill="none" stroke="var(--border)" strokeWidth="8" opacity="0.45" />
          <circle
            cx="55"
            cy="55"
            r={R}
            fill="none"
            stroke="currentColor"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${(circumference * score) / 100} ${circumference}`}
            transform="rotate(-90 55 55)"
            style={{ transition: "stroke-dasharray 0.9s var(--ease)" }}
          />
        </svg>
        <div className="verdict-ring-value">
          <strong>{score}</strong>
          <span>из 100</span>
        </div>
      </div>

      <div className="verdict-body">
        <div className="verdict-label">{meta.label}</div>
        <h3 className="verdict-headline">{report.headline || meta.pitch}</h3>
        <div className="verdict-meta">
          <span title="Что анализировали">
            <code>{report.target.service || "—"}</code>
            {report.target.namespace && <span className="muted"> · {report.target.namespace}</span>}
          </span>
          <span className="muted">{formatWindow(report.window_from, report.window_to)}</span>
          <span className="tag" title={TEST_KIND_META[report.test_kind]?.hint}>
            {TEST_KIND_META[report.test_kind]?.label ?? report.test_kind}
          </span>
          {report.demo && (
            <span className="tag verdict-demo" title="Синтетические данные: так модуль выглядит в работе">
              демо-данные
            </span>
          )}
        </div>

        <div className="pulse-badges verdict-counts">
          {(["critical", "major", "minor"] as Severity[]).map((level) =>
            counts[level] > 0 ? (
              <span key={level} className={`pulse-badge ${SEVERITY_META[level].tone}`}>
                {SEVERITY_META[level].label}: {counts[level]}
              </span>
            ) : null,
          )}
          {report.findings.length === 0 && (
            <span className="pulse-badge chain">Находок нет</span>
          )}
          {report.hypotheses.length > 0 && (
            <span className="pulse-badge chain">
              Гипотез: {report.hypotheses.length}
            </span>
          )}
        </div>

        {!report.validity.valid && (
          <div className="verdict-warning">
            <strong>Прогон под вопросом.</strong> {report.validity.reasons.join(" ")}
          </div>
        )}
      </div>
    </section>
  );
}

function countBySeverity(levels: Severity[]): Record<Severity, number> {
  const out: Record<Severity, number> = { critical: 0, major: 0, minor: 0, info: 0 };
  for (const level of levels) out[level] += 1;
  return out;
}
