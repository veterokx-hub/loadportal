"use client";

import Link from "next/link";
import type { AppModule, AppModuleId } from "@/lib/modules";
import { scenarioPath } from "@/lib/routes";

export function ModulePlaceholder({
  module,
  moduleIndex,
}: {
  module: AppModule;
  moduleIndex: number;
}) {
  return (
    <div className="panel module-placeholder">
      <div className="module-placeholder-hero">
        <div className="module-placeholder-badge">
          Раздел {moduleIndex + 1} · скоро
        </div>
        <h2>{module.title}</h2>
        <p className="muted module-placeholder-blurb">{module.blurb}</p>
      </div>

      <div className="module-placeholder-body">
        <h3>Что появится в этом разделе</h3>
        <ul className="module-preview-list">
          {module.preview.map((item) => (
            <li key={item}>
              <span className="module-preview-dot" aria-hidden />
              {item}
            </li>
          ))}
        </ul>

        <div className="module-placeholder-pipeline" aria-hidden>
          {(
            [
              ["scenario", "Сценарий"],
              ["environment", "Стенд"],
              ["run", "Запуск"],
              ["analysis", "Анализ"],
              ["report", "Отчёт"],
            ] as [AppModuleId, string][]
          ).map(([id, label], i) => (
            <div key={id} className="module-pipeline-item">
              {i > 0 && <span className="module-pipeline-arrow">→</span>}
              <span
                className={`module-pipeline-pill ${
                  id === module.id ? "current" : id === "scenario" ? "done" : ""
                }`}
              >
                {label}
              </span>
            </div>
          ))}
        </div>

        <p className="hint" style={{ marginTop: 16 }}>
          Сейчас доступны разделы «Сценарий» и «Запуск». Остальные модули подключаются по
          мере внедрения платформы.
        </p>

        <div className="footer-nav" style={{ marginTop: 20 }}>
          <Link href={scenarioPath("source")} className="ghost">
            ← К подготовке сценария
          </Link>
        </div>
      </div>
    </div>
  );
}
