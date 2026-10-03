"use client";

import { useState } from "react";
import { saveBuild } from "@/lib/api";
import type { Scenario } from "@/lib/types";
import { ENGINES, type Engine } from "@/lib/engines";

/**
 * Диалог «Сохранить текущую сборку?» — показывается перед действиями,
 * которые заменяют текущий сценарий (новый сценарий, подтягивание старой сборки).
 */
export function SaveScenarioDialog({
  scenario,
  title,
  message,
  defaultEngine = "jmeter",
  onCancel,
  onDone,
}: {
  scenario: Scenario;
  title: string;
  message: string;
  defaultEngine?: Engine;
  onCancel: () => void;
  /** Вызывается после сохранения (saved=true) или при «продолжить без сохранения». */
  onDone: (saved: boolean) => void;
}) {
  const [engine, setEngine] = useState<Engine>(defaultEngine);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveAndContinue() {
    setSaving(true);
    setError(null);
    try {
      await saveBuild(scenario, engine);
      onDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  return (
    <div className="docs-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="panel docs-panel" style={{ maxWidth: 520 }}>
        <h2 style={{ marginTop: 0 }}>{title}</h2>
        <p className="muted">{message}</p>

        <div className="field">
          <label>Движок для сохранения</label>
          <div className="inline">
            {ENGINES.map((e) => (
              <div
                key={e.id}
                className={`pill-source pill-engine ${engine === e.id ? "active" : ""}`}
                onClick={() => setEngine(e.id)}
              >
                {e.label}
                <span className="pill-engine-tagline">{e.tagline}</span>
              </div>
            ))}
          </div>
        </div>

        {error && <div className="error">Не удалось сохранить сборку: {error}</div>}

        <div className="footer-nav" style={{ marginTop: 16 }}>
          <button className="ghost" onClick={onCancel} disabled={saving}>
            Отмена
          </button>
          <div className="inline" style={{ gap: 8 }}>
            <button className="ghost" onClick={() => onDone(false)} disabled={saving}>
              Не сохранять
            </button>
            <button onClick={saveAndContinue} disabled={saving}>
              {saving ? "Сохраняем…" : "Сохранить сборку"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
