# Модуль «Анализ»

После прогона сервис забирает ряды из VictoriaMetrics, размечает фазы нагрузки и ищет отклонения на однородных участках. Рост CPU вместе с RPS на разгоне аномалией не считается.

Математика — `analysis` (FastAPI, порт 8003). Очередь, Postgres и REST — `orchestrator` (8082). UI — `/analysis/new`, `/analysis/list`, `/analysis/{id}`.

Связанные документы: [module-3-run.md](module-3-run.md), [domain-model.md](domain-model.md), [data-model-ids.md](data-model-ids.md), [metrics.md](metrics.md).

## Как проходит отчёт

1. Orchestrator принимает `POST /api/analysis` и пишет `analysis_runs` со статусом `queued`.
2. `AnalysisService` вызывает `POST /analyze` у `analysis`.
3. Сервис читает каталог YAML, первым проходом забирает ряды крупным шагом, строит фазы по фактическому RPS (если точек мало — по заявленному профилю).
4. Детекторы смотрят полки и ступени. Второй проход мелким шагом уточняет окна уже найденных отклонений и выкидывает одиночные всплески.
5. Корреляция собирает цепочку «причина → следствие», гипотезы сопоставляют цепочку с паттерном из каталога.
6. Отчёт целиком возвращается в `report_json`. Список строится по колонкам `verdict`, `health_score`, `headline`, `findings_count`.

Пустой URL VictoriaMetrics или галочка «Показать на демо-данных» включают синтетику (`demo.py`). Дефект (`leak`, `pool`, `throttle`, `clean`) берётся из запроса или из хеша `run_id`. Принудительный демо-режим: Consul `analysis/demo`.

После терминального статуса прогона orchestrator сам ставит анализ, если заполнены cluster / namespace / service / container. Выключатель: Consul `analysis/auto-on-finish`, иначе `loadtest.analysis.auto-on-finish`.

Токен между orchestrator и analysis — `X-Internal-Token` (Vault `loadtest/internal-token`).

## Детекторы

Пороги — `analysis/app/catalog/rules.yaml`, `ruleset_version` сейчас `1.0.0`.

| id | Что ищет |
|---|---|
| `level` | сдвиг медианы на полке, робастная σ через MAD |
| `drift` | монотонный тренд, Тейл–Сен и Манн–Кендалл |
| `invariant` | явный порог или SLO из каталога |
| `event` | дискретное событие (рестарт, смена образа) |
| `capacity` | для `max_search`: на каком RPS упёрлись и какой ряд сломался первым |

Одинаковые находки схлопываются: дрейф важнее уровня на той же метрике, насыщение важнее сырого значения, нарушение SLO важнее соседнего статистического сдвига, следствия уходят в цепочку. Отброшенное остаётся в `suppressed` строкой.

Вердикт: `healthy`, `degraded`, `unhealthy`, `inconclusive`. `health_score` — 0–100. `coverage.score` показывает, какую долю каталога удалось прочитать. Вердикт «чисто» при низком покрытии мало что значит.

## Каталоги

Читаются один раз при старте. Ошибка YAML роняет процесс, а не первый отчёт.

| файл | содержимое |
|---|---|
| `analysis/app/catalog/metrics.yaml` | MetricsQL, единицы, важность, производные ряды |
| `analysis/app/catalog/rules.yaml` | пороги детекторов и инварианты |
| `analysis/app/catalog/hypotheses.yaml` | паттерн → текст гипотезы и пункты «куда смотреть» |

Имена рядов в каталоге надо совместить с конкретной VictoriaMetrics. На синтетике они не проверяются.

## Контракт отчёта

Форма — `AnalysisReport` в `analysis/app/models.py` и зеркало `frontend/lib/analysis.ts`. Поля перечислены в [domain-model.md](domain-model.md). Находка без `summary`, `next_step`, `query` и `spark` в этот контракт не входит.

`POST /api/analysis/{id}/rerun` повторяет `request_json` той же записи: окно, цель, тип теста, SLO и дефект демо.

## Чего нет

- сравнения с предыдущим прогоном того же `test_id`;
- ряда `ALERTS` из vmalert;
- промежуточного пересчёта длинного теста по ходу;
- пометки «это не аномалия» и подстройки порогов по таким пометкам;
- LLM-текста поверх каталога. Поле `hypothesis.source` допускает значение `llm`, генератора нет.
