"use client";

import { useState } from "react";
import {
  DETECTOR_META,
  PHASE_META,
  SEVERITY_META,
  formatDurationSec,
  formatValue,
  type Finding,
} from "@/lib/analysis";
import { Sparkline } from "./Sparkline";

/** Подписи полей доказательной базы. Порядок — от «что видно» к «как посчитано». */
const EVIDENCE_ROWS: { key: keyof Finding["evidence"]; label: string; hint: string }[] = [
  { key: "observed", label: "Наблюдалось", hint: "Значение в найденном интервале" },
  { key: "baseline", label: "База", hint: "Медиана до отклонения" },
  { key: "threshold", label: "Порог", hint: "Порог правила или лимит контейнера" },
  { key: "deviation_pct", label: "Отклонение", hint: "Насколько ушло от базы" },
  { key: "slope_pct_per_hour", label: "Скорость роста", hint: "Процентов в час" },
  { key: "projection_hours", label: "Запас", hint: "Часов до порога при этой скорости" },
  { key: "breach_sec", label: "Держалось", hint: "Сколько длилось нарушение" },
  { key: "robust_z", label: "Робастная z", hint: "В скольких σ от медианы; σ по MAD" },
  { key: "p_value", label: "p-value", hint: "Вероятность увидеть такой тренд на случайном ряде" },
  { key: "at_rps", label: "При нагрузке", hint: "RPS в момент находки" },
];

/** Часть полей доказательной базы измеряется не в единицах самой метрики. */
function evidenceText(key: keyof Finding["evidence"], value: number, metricUnit: string): string {
  switch (key) {
    case "projection_hours":
      return `${Math.round(value)} ч`;
    case "breach_sec":
      return formatDurationSec(value);
    case "deviation_pct":
      return formatValue(value, "percent");
    case "slope_pct_per_hour":
      // Без «в час» темп читается как разовое отклонение: «52 %» и «52 % в час» —
      // это «уже плохо» против «через три часа будет отказ».
      return `${formatValue(value, "percent")}/ч`;
    case "at_rps":
      return formatValue(value, "rps");
    case "robust_z":
      return formatValue(value, "");
    case "p_value":
      // Хвост нормального распределения на длинном ряде уходит за точность double,
      // и ровный «0,00» выглядит как незаполненное поле, а не как «почти наверняка».
      return value < 0.001 ? "< 0,001" : formatValue(value, "");
    default:
      return formatValue(value, metricUnit);
  }
}

export function FindingCard({
  finding,
  highlighted,
}: {
  finding: Finding;
  highlighted?: boolean;
}) {
  const [showProof, setShowProof] = useState(false);
  const meta = SEVERITY_META[finding.severity];
  const detector = DETECTOR_META[finding.detector];
  const durationSec = (new Date(finding.to_ts).getTime() - new Date(finding.from_ts).getTime()) / 1000;

  return (
    <article
      id={`finding-${finding.id}`}
      className={`finding sev-${meta.tone} ${highlighted ? "highlighted" : ""}`}
    >
      <header className="finding-head">
        <span className={`finding-sev pulse-badge ${meta.tone}`} title={meta.label}>
          {meta.label}
        </span>
        <div className="finding-titles">
          <h4 className="finding-title">{finding.title}</h4>
          <span className="finding-metric" title="Метрика из каталога">
            {finding.metric_title}
          </span>
        </div>
      </header>

      <p className="finding-summary">{finding.summary}</p>

      <div className="finding-chart">
        <Sparkline spark={finding.spark} tone={meta.tone} />
      </div>

      {finding.next_step && (
        <div className="finding-next">
          <span className="finding-next-mark" aria-hidden>
            →
          </span>
          <span>{finding.next_step}</span>
        </div>
      )}

      <div className="finding-tags">
        <span className="tag" title={detector.hint}>
          {detector.label}
        </span>
        {finding.phase && (
          <span className="tag" title={PHASE_META[finding.phase].hint}>
            {PHASE_META[finding.phase].label}
          </span>
        )}
        <span className="tag" title="Длительность интервала находки">
          {formatDurationSec(durationSec)}
        </span>
        {finding.confidence < 50 && (
          <span className="tag finding-doubt" title="Детектор не уверен — проверьте руками">
            под вопросом
          </span>
        )}
        <button
          type="button"
          className="ghost small finding-proof-toggle"
          onClick={() => setShowProof((v) => !v)}
        >
          {showProof ? "Скрыть числа" : "Показать числа"}
        </button>
      </div>

      {showProof && (
        <div className="finding-proof">
          <dl className="finding-evidence">
            {EVIDENCE_ROWS.map((row) => {
              const raw = finding.evidence[row.key];
              if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
              return (
                <div key={row.key} title={row.hint}>
                  <dt>{row.label}</dt>
                  <dd>{evidenceText(row.key, raw, finding.unit)}</dd>
                </div>
              );
            })}
          </dl>
          {finding.query && (
            <div className="finding-query">
              <span className="muted">Запрос, по которому получен ряд:</span>
              <code>{finding.query}</code>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
