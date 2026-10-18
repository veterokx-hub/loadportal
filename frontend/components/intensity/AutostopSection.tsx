"use client";

import type { AutoStop } from "@/lib/types";
import type { Engine } from "@/lib/engines";
import { NumberField } from "@/components/NumberField";
import { FormSection } from "@/components/intensity/FormSection";

/** Подписи и семантика авто-остановки различаются по движкам — здесь они собраны рядом. */
const COPY: Record<
  Engine,
  { mechanism: string; errWindow: string; avgWindow: string; windowTitle: string; how: string[] }
> = {
  jmeter: {
    mechanism: "jpgc-autostop",
    errWindow: "Окно ошибок, с",
    avgWindow: "Окно отклика, с",
    windowTitle: "Скользящее окно: порог считается за последние N секунд",
    how: [
      "Скользящее окно плагина: доля ошибочных сэмплов (assertions и сетевые) и средний отклик за последние N секунд.",
      "Тест останавливается на ходу.",
    ],
  },
  k6: {
    mechanism: "thresholds + abortOnFail",
    errWindow: "Пауза ошибок, с",
    avgWindow: "Пауза отклика, с",
    windowTitle: "delayAbortEval: первые N секунд порог не проверяется",
    how: [
      "Скользящего окна в k6 нет: первые N секунд порог не проверяется, дальше доля ошибок и средний отклик считаются накопительно с начала теста.",
      "Ошибка — status 0 или провал проверки, а не сырой http_req_failed.",
    ],
  },
  gatling: {
    mechanism: "crashLoadGeneratorIf + assertions",
    errWindow: "Окно ошибок, с",
    avgWindow: "Окно отклика, с",
    windowTitle: "Скользящее окно: порог считается за последние N секунд",
    how: [
      "Simulation считает KO и средний отклик за последние N секунд и при превышении рвёт прогон с ненулевым кодом выхода.",
      "Пока окно не набралось, критерий молчит: одна ранняя ошибка тест не убивает. Те же пороги — в assertions для итогового вердикта.",
    ],
  },
};

export function AutostopSection({
  engine,
  autostop,
  setAutostop,
}: {
  engine: Engine;
  autostop: AutoStop;
  setAutostop: (patch: Partial<AutoStop>) => void;
}) {
  const copy = COPY[engine];
  return (
    <FormSection
      title="AutoStop"
      aside={
        <label className="check-inline">
          <input
            type="checkbox"
            checked={autostop.enabled}
            onChange={(e) => setAutostop({ enabled: e.target.checked })}
          />
          Включён
          <span className="muted">· {copy.mechanism}</span>
        </label>
      }
      lead={
        autostop.enabled
          ? "Тест остановится, если ошибки или средний отклик превысят порог."
          : "Выключен: тест идёт до конца профиля при любых ошибках."
      }
      details={autostop.enabled ? copy.how : undefined}
    >
      {autostop.enabled && (
        <div className="compact-grid">
          <div className="field span-3">
            <label>Ошибки, %</label>
            <NumberField
              fieldId="as-err-pct"
              value={autostop.error_rate_pct}
              min={0}
              onCommit={(n) => setAutostop({ error_rate_pct: n })}
            />
          </div>
          <div className="field span-3">
            <label title={copy.windowTitle}>{copy.errWindow}</label>
            <NumberField
              fieldId="as-err-sec"
              value={autostop.error_rate_sec}
              min={0}
              title={copy.windowTitle}
              onCommit={(n) => setAutostop({ error_rate_sec: n })}
            />
          </div>
          <div className="field span-3">
            <label title="0 — не проверять">Ср. отклик, мс</label>
            <NumberField
              fieldId="as-avg-ms"
              value={autostop.avg_response_ms}
              min={0}
              required={false}
              placeholder="0 — выкл."
              title="0 — не проверять"
              onCommit={(n) => setAutostop({ avg_response_ms: n })}
            />
          </div>
          <div className="field span-3">
            <label title={copy.windowTitle}>{copy.avgWindow}</label>
            <NumberField
              fieldId="as-avg-sec"
              value={autostop.avg_response_sec}
              min={0}
              required={false}
              title={copy.windowTitle}
              onCommit={(n) => setAutostop({ avg_response_sec: n })}
            />
          </div>
        </div>
      )}
    </FormSection>
  );
}
