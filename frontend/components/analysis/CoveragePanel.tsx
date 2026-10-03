"use client";

import { useState } from "react";
import type { Coverage, Cost } from "@/lib/analysis";

const GROUP_LABELS: Record<string, string> = {
  load: "Нагрузка",
  latency: "Время ответа",
  errors: "Ошибки",
  cpu: "CPU",
  memory: "Память",
  gc: "Сборка мусора",
  threads: "Потоки",
  runtime: "Рантайм",
  db: "База данных",
  cache: "Кэш",
  queue: "Очереди",
  network: "Сеть",
  lifecycle: "Жизненный цикл",
  derived: "Производные",
};

/**
 * «Что я вообще смотрел».
 *
 * Без этого блока вердикт «всё чисто» ничего не стоит: он одинаково выглядит
 * и когда метрики в порядке, и когда половина рядов не приехала из источника.
 */
export function CoveragePanel({ coverage, cost }: { coverage: Coverage; cost: Cost }) {
  const [open, setOpen] = useState(false);
  const tone = coverage.score >= 70 ? "ok" : coverage.score >= 40 ? "warn" : "err";

  return (
    <section className={`coverage tone-${tone}`}>
      <button type="button" className="coverage-head" onClick={() => setOpen((v) => !v)}>
        <span className="coverage-score">
          <strong>{coverage.score}%</strong>
          <span className="muted">покрытие метрик</span>
        </span>
        <span className="coverage-line">
          Прочитано {coverage.available} из {coverage.requested} рядов
          {coverage.groups_missing.length > 0 && (
            <span className="muted">
              {" "}
              · не нашлось: {coverage.groups_missing.map((g) => GROUP_LABELS[g] ?? g).join(", ")}
            </span>
          )}
        </span>
        <span className="pulse-chevron">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="coverage-body">
          <div className="coverage-groups">
            {coverage.groups_ok.map((g) => (
              <span key={g} className="tag coverage-ok">
                {GROUP_LABELS[g] ?? g}
              </span>
            ))}
            {coverage.groups_missing.map((g) => (
              <span key={g} className="tag coverage-missing" title="Метрик этой группы в источнике нет">
                {GROUP_LABELS[g] ?? g}
              </span>
            ))}
          </div>

          <div className="coverage-cost">
            <span>
              Запросов в источник: <strong>{cost.queries}</strong>
            </span>
            <span>
              Точек прочитано: <strong>{cost.points_fetched.toLocaleString("ru-RU")}</strong>
            </span>
            <span>
              Шаг: <strong>{cost.step_sec} с</strong>
            </span>
            {cost.refined_metrics > 0 && (
              <span title="Подозрительные метрики перечитаны на мелком шаге">
                Уточнено: <strong>{cost.refined_metrics}</strong>
              </span>
            )}
            <span>
              Заняло: <strong>{(cost.duration_ms / 1000).toFixed(1)} с</strong>
            </span>
          </div>

          {cost.degraded && (
            <div className="coverage-degraded">
              Источник отвечал не полностью: {cost.degraded_reason || "часть запросов деградировала"}.
              Выводы могли пострадать.
            </div>
          )}

          {coverage.metrics.length > 0 && (
            <div className="table-wrap coverage-table">
              <table>
                <thead>
                  <tr>
                    <th>Метрика</th>
                    <th>Группа</th>
                    <th>Точек</th>
                    <th>Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {coverage.metrics.map((m) => (
                    <tr key={m.key}>
                      <td>{m.title}</td>
                      <td className="muted">{GROUP_LABELS[m.group] ?? m.group}</td>
                      <td className="muted">{m.points || "—"}</td>
                      <td>
                        <span className={`tag coverage-${m.status === "ok" ? "ok" : "missing"}`}>
                          {m.status === "ok" ? "есть" : m.status === "empty" ? "нет ряда" : "ошибка"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
