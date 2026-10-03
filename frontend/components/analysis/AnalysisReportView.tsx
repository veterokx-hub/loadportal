"use client";

import { useMemo, useState } from "react";
import { SEVERITY_META, type AnalysisReport, type Severity } from "@/lib/analysis";
import { VerdictHero } from "./VerdictHero";
import { PhaseTimeline } from "./PhaseTimeline";
import { HypothesisCard } from "./HypothesisCard";
import { CorrelationChain } from "./CorrelationChain";
import { FindingCard } from "./FindingCard";
import { CoveragePanel } from "./CoveragePanel";

const SEVERITY_ORDER: Severity[] = ["critical", "major", "minor", "info"];

/**
 * Отчёт целиком. Порядок блоков — это и есть продукт:
 * вердикт → гипотезы → цепочки → находки → покрытие.
 *
 * Начинать с находок было бы честно, но бесполезно: неопытный человек получает
 * двадцать карточек и не знает, с какой начать. Гипотеза первой отвечает на его
 * настоящий вопрос — «что мне с этим делать».
 */
export function AnalysisReportView({ report }: { report: AnalysisReport }) {
  const [active, setActive] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<Severity | "">("");

  const findings = useMemo(
    () =>
      [...report.findings].sort(
        (a, b) =>
          SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
          new Date(a.from_ts).getTime() - new Date(b.from_ts).getTime(),
      ),
    [report.findings],
  );

  const visible = severityFilter ? findings.filter((f) => f.severity === severityFilter) : findings;

  function focus(id: string) {
    setActive(id);
    setSeverityFilter("");
    // Карточка может быть скрыта фильтром — даём React отрисовать её до скролла.
    requestAnimationFrame(() => {
      document.getElementById(`finding-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  return (
    <div className="report">
      <VerdictHero report={report} />

      {report.phases.length > 0 && (
        <section className="report-block">
          <h3>Как шёл тест</h3>
          <PhaseTimeline
            phases={report.phases}
            findings={findings}
            activeId={active}
            onPick={focus}
          />
        </section>
      )}

      {report.capacity && report.capacity.max_sustained_rps > 0 && (
        <section className="report-block">
          <h3>Ёмкость сервиса</h3>
          <div className="capacity">
            <div className="capacity-figure">
              <strong>{Math.round(report.capacity.max_sustained_rps)}</strong>
              <span>rps держит стабильно</span>
            </div>
            <div className="capacity-body">
              <p>{report.capacity.reason}</p>
              {report.capacity.first_limiter_title && (
                <p className="muted">
                  Первым упёрлось: <strong>{report.capacity.first_limiter_title}</strong>
                  {report.capacity.knee_rps > 0 &&
                    ` — перелом около ${Math.round(report.capacity.knee_rps)} rps`}
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      {report.hypotheses.length > 0 && (
        <section className="report-block">
          <h3>Гипотезы: что, вероятно, происходит</h3>
          <p className="hint report-lead">
            Модуль сопоставил форму метрик с известными паттернами отказов. Это подсказка,
            куда смотреть первым делом, — не готовый диагноз.
          </p>
          <div className="hyp-list">
            {report.hypotheses.map((h, i) => (
              <HypothesisCard
                key={h.id}
                hypothesis={h}
                findings={findings}
                index={i}
                onPickFinding={focus}
              />
            ))}
          </div>
        </section>
      )}

      {report.correlations.length > 0 && (
        <section className="report-block">
          <h3>Что за чем потянулось</h3>
          <div className="chain-list">
            {report.correlations.map((c) => (
              <CorrelationChain
                key={c.id}
                correlation={c}
                findings={findings}
                onPickFinding={focus}
              />
            ))}
          </div>
        </section>
      )}

      <section className="report-block">
        <div className="report-block-head">
          <h3>Находки{findings.length > 0 && <span className="muted"> · {findings.length}</span>}</h3>
          {findings.length > 1 && (
            <div className="finding-filters">
              <button
                type="button"
                className={`pill-source ${severityFilter === "" ? "active" : ""}`}
                onClick={() => setSeverityFilter("")}
              >
                Все
              </button>
              {SEVERITY_ORDER.filter((level) => findings.some((f) => f.severity === level)).map(
                (level) => (
                  <button
                    type="button"
                    key={level}
                    className={`pill-source ${severityFilter === level ? "active" : ""}`}
                    onClick={() => setSeverityFilter(level)}
                  >
                    {SEVERITY_META[level].label}
                  </button>
                ),
              )}
            </div>
          )}
        </div>

        {findings.length === 0 ? (
          <div className="report-clean">
            <div className="report-clean-mark" aria-hidden>
              ✓
            </div>
            <div>
              <strong>Отклонений не нашлось.</strong>
              <p className="muted">
                Все метрики держались в пределах своей же нормы, устойчивых трендов на плато нет,
                пороги не нарушались. Проверьте блок покрытия ниже: вывод стоит ровно столько,
                сколько метрик удалось прочитать.
              </p>
            </div>
          </div>
        ) : (
          <div className="finding-list">
            {visible.map((f) => (
              <FindingCard key={f.id} finding={f} highlighted={active === f.id} />
            ))}
          </div>
        )}
      </section>

      <CoveragePanel coverage={report.coverage} cost={report.cost} />

      {report.suppressed.length > 0 && <SuppressedList items={report.suppressed} />}

      <div className="report-footer muted">
        Правила версии <code>{report.ruleset_version}</code> · отчёт собран{" "}
        {new Date(report.generated_at).toLocaleString("ru-RU")}
        {report.test_id && (
          <>
            {" "}
            · задача <code>{report.test_id}</code>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Отсеянные находки показываются намеренно: молчащий детектор вызывает
 * подозрение, а «видел, но отбросил вот почему» — доверие.
 */
function SuppressedList({ items }: { items: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="suppressed">
      <button type="button" className="suppressed-head" onClick={() => setOpen((v) => !v)}>
        Отброшено как шум: {items.length}
        <span className="pulse-chevron">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <ul className="suppressed-list">
          {items.map((text, i) => (
            <li key={i}>{text}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
