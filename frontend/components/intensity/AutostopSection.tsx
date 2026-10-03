"use client";

import type { AutoStop } from "@/lib/types";
import type { Engine } from "@/lib/engines";
import { NumberField } from "@/components/NumberField";

/** Подписи и семантика авто-остановки различаются по движкам — здесь они собраны рядом. */
const COPY: Record<
  Engine,
  { caption: string; windowLabel: string; avgWindowLabel: string; hint: string }
> = {
  jmeter: {
    caption: "плагин jpgc-autostop",
    windowLabel: "...в течение, с",
    avgWindowLabel: "...в течение, с",
    hint: "Скользящее окно плагина: доля ошибочных сэмплов (assertions + сетевые) и средний отклик за указанное число секунд. Тест рвётся на ходу.",
  },
  k6: {
    caption: "thresholds + abortOnFail",
    windowLabel: "Задержка проверки, с",
    avgWindowLabel: "Задержка avg, с",
    hint: "Скользящего окна в k6 нет. «Задержка» — delayAbortEval: порог не смотрит первые N секунд, дальше доля ошибок и avg считаются с начала теста накопительно. Ошибка = status 0 или провал валидации, а не сырой http_req_failed.",
  },
  gatling: {
    caption: "crashLoadGeneratorIf + assertions",
    windowLabel: "...в течение, с",
    avgWindowLabel: "...в течение, с",
    hint: "Настоящее скользящее окно, как в jpgc-autostop: счётчик в сгенерированной Simulation считает KO и средний отклик за последние N секунд и рвёт прогон через crashLoadGeneratorIf с ненулевым кодом выхода. Пока окно не набралось, критерий молчит — одна ранняя ошибка тест не убивает. Те же пороги закреплены в assertions как итоговый вердикт.",
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
    <>
      <h3 style={{ fontSize: 13, marginTop: 18 }}>AutoStop (авто-остановка теста)</h3>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="field" style={{ flex: "none" }}>
          <label>Включить</label>
          <label className="inline" style={{ textTransform: "none" }}>
            <input
              type="checkbox"
              style={{ width: "auto" }}
              checked={autostop.enabled}
              onChange={(e) => setAutostop({ enabled: e.target.checked })}
            />
            <span className="muted">{copy.caption}</span>
          </label>
        </div>
        {autostop.enabled && (
          <>
            <div className="field" style={{ width: 130, flex: "none" }}>
              <label>Ошибки, %</label>
              <NumberField
                fieldId="as-err-pct"
                value={autostop.error_rate_pct}
                min={0}
                onCommit={(n) => setAutostop({ error_rate_pct: n })}
              />
            </div>
            <div className="field" style={{ width: 150, flex: "none" }}>
              <label>{copy.windowLabel}</label>
              <NumberField
                fieldId="as-err-sec"
                value={autostop.error_rate_sec}
                min={0}
                onCommit={(n) => setAutostop({ error_rate_sec: n })}
              />
            </div>
            <div className="field" style={{ width: 150, flex: "none" }}>
              <label>Ср. отклик, мс (0=выкл)</label>
              <NumberField
                fieldId="as-avg-ms"
                value={autostop.avg_response_ms}
                min={0}
                required={false}
                onCommit={(n) => setAutostop({ avg_response_ms: n })}
              />
            </div>
            <div className="field" style={{ width: 150, flex: "none" }}>
              <label>{copy.avgWindowLabel}</label>
              <NumberField
                fieldId="as-avg-sec"
                value={autostop.avg_response_sec}
                min={0}
                required={false}
                onCommit={(n) => setAutostop({ avg_response_sec: n })}
              />
            </div>
          </>
        )}
      </div>
      {autostop.enabled && <div className="hint">{copy.hint}</div>}
    </>
  );
}
