"use client";

import { useMemo, useState, type CSSProperties } from "react";
import type { Scenario } from "@/lib/types";
import { analyzeScenario, type ReadinessCheck } from "@/lib/readiness";

const SEV_ICON: Record<string, string> = {
  error: "✕",
  warning: "⚠",
  tip: "💡",
  ok: "✓",
};

export function ScenarioPulse({
  scenario,
  currentStep,
  onGoToStep,
  expanded: expandedProp,
}: {
  scenario: Scenario;
  currentStep: number;
  onGoToStep?: (step: number) => void;
  expanded?: boolean;
}) {
  const report = useMemo(() => analyzeScenario(scenario), [scenario]);
  const [expanded, setExpanded] = useState(expandedProp ?? false);
  const [copied, setCopied] = useState(false);

  const ringColor =
    report.score >= 90
      ? "var(--ok)"
      : report.score >= 70
        ? "var(--neon)"
        : report.score >= 45
          ? "#f0b429"
          : "var(--danger)";

  const circumference = 2 * Math.PI * 36;
  const dash = (report.score / 100) * circumference;

  function copyPitch() {
    navigator.clipboard.writeText(report.pitch).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function onCheckClick(c: ReadinessCheck) {
    if (c.step !== undefined && onGoToStep) onGoToStep(c.step);
  }

  return (
    <div className={`pulse-panel ${expanded ? "expanded" : ""}`}>
      <div className="pulse-head" onClick={() => setExpanded((e) => !e)}>
        <div className="pulse-score" style={{ "--ring-color": ringColor } as CSSProperties}>
          <svg viewBox="0 0 80 80" width="56" height="56" aria-hidden>
            <circle cx="40" cy="40" r="36" fill="none" stroke="var(--border)" strokeWidth="5" />
            <circle
              cx="40"
              cy="40"
              r="36"
              fill="none"
              stroke="var(--ring-color)"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference}`}
              transform="rotate(-90 40 40)"
              style={{ filter: "drop-shadow(0 0 6px var(--ring-color))" }}
            />
            <text x="40" y="44" textAnchor="middle" fontSize="16" fontWeight="700" fill="var(--text)">
              {report.score}
            </text>
          </svg>
          <div className="pulse-score-meta">
            <strong>{report.label}</strong>
            <span className="muted">
              {report.requestCount} запр. · {report.peakRps} RPS · ~
              {report.durationSec < 60
                ? `${report.durationSec}с`
                : `${Math.round(report.durationSec / 60)}мин`}
            </span>
          </div>
        </div>

        <p className="pulse-pitch">{report.pitch}</p>

        <div className="pulse-badges">
          {report.blockers > 0 && (
            <span className="pulse-badge err">{report.blockers} блокер</span>
          )}
          {report.warnings > 0 && (
            <span className="pulse-badge warn">{report.warnings} предупр.</span>
          )}
          {report.chainCount > 0 && (
            <span className="pulse-badge chain">{report.chainCount} цепочка</span>
          )}
          <span className="muted pulse-chevron">{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {expanded && (
        <div className="pulse-body">
          {report.flow.nodes.length > 0 && (
            <section className="pulse-section">
              <h3>Карта потока</h3>
              <div className="pulse-flow">
                {report.flow.nodes.map((node, i) => {
                  const edgeToNext = report.flow.edges.find(
                    (e) => e.from === node.id && report.flow.nodes[i + 1]?.id === e.to
                  );
                  return (
                    <div key={node.id} className="pulse-flow-seg">
                      <div
                        className={`pulse-node ${node.hasIssue ? "issue" : ""} ${
                          currentStep === 2 ? "interactive" : ""
                        }`}
                        title={node.name}
                      >
                        <span className={`method ${node.method}`}>{node.method}</span>
                        <span className="pulse-node-name">{node.name}</span>
                        {node.extractions.length > 0 && (
                          <span className="pulse-node-ext">
                            → {node.extractions.map((v) => `\${${v}}`).join(", ")}
                          </span>
                        )}
                      </div>
                      {i < report.flow.nodes.length - 1 && (
                        <div className="pulse-arrow">
                          {edgeToNext ? (
                            <span className="pulse-var" title={edgeToNext.variable}>
                              ${"{"}
                              {edgeToNext.variable}
                              {"}"}
                            </span>
                          ) : (
                            "→"
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="pulse-section">
            <div className="pulse-section-head">
              <h3>Чеклист готовности</h3>
              <button className="ghost small" onClick={copyPitch} type="button">
                {copied ? "Скопировано ✓" : "Копировать описание"}
              </button>
            </div>
            <ul className="pulse-checks">
              {report.checks.map((c) => (
                <li
                  key={c.id}
                  className={`pulse-check ${c.severity} ${c.step !== undefined ? "clickable" : ""}`}
                  onClick={() => onCheckClick(c)}
                  title={c.hint}
                >
                  <span className="pulse-check-icon">{SEV_ICON[c.severity]}</span>
                  <span>{c.message}</span>
                  {c.step !== undefined && onGoToStep && (
                    <span className="pulse-check-go">шаг {c.step + 1} →</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
