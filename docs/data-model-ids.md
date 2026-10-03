# Идентификаторы

Схема — Liquibase, `constructor/src/main/resources/db/changelog/db.changelog-master.yaml`. Таблицы `projects` и `scenarios` удалены: сценарий живёт в `build_records.scenario_json`.

```
build_id ──► script_id ──► run_id ──► analysis_id
                │              │
                │              └── test_id (Jira, ввод при запуске)
                └── файл в Postgres и копия в S3 на время прогона
```

| ID | Где | Описание |
|---|---|---|
| `build_id` | `build_records.id` | Снимок Scenario и движок. До 30 на пользователя, TTL по `loadtest.builds.retention-days` (30). |
| `script_id` | `scripts.id` | Артефакт. Источник `portal_build` или `upload`. Движок `jmeter`, `k6` или `gatling`. |
| `test_id` | `test_runs.test_id` | Ключ Jira. Уходит в GitLab как `RUN_ID`. |
| `run_id` | `test_runs.id` | Прогон. Его же orchestrator передаёт в webhook как `PORTAL_RUN_ID`. |
| `analysis_id` | `analysis_runs.id` | Отчёт анализа. `test_run_id` пустой, если цель введена вручную. |

## `build_records`

`id`, `username`, `scenario_name`, `engine`, `filename`, `scenario_json`, `created_at`.

## `scripts`

| колонка | смысл |
|---|---|
| `id` | script_id |
| `username` | владелец |
| `build_id` | сборка, из которой собран артефакт; пусто для upload |
| `engine` | `jmeter` \| `k6` \| `gatling` |
| `filename` | имя файла |
| `source` | `portal_build` \| `upload` |
| `git_url` | колонка есть, запуск в git сценарий не кладёт |
| `content` | тело артефакта |
| `created_at` | |

## `test_runs`

| колонка | смысл |
|---|---|
| `id` | run_id |
| `test_id` | ключ Jira |
| `script_id`, `build_id` | откуда скрипт |
| `username`, `scenario_name`, `engine` | |
| `target_url` | URL стенда из сценария, может быть пустым |
| `target_cluster`, `target_namespace`, `target_service`, `target_container` | цель для VictoriaMetrics. Для старта прогона не обязательны |
| `params_json` | cpu, memory, окно, путь в S3, replicas |
| `labels_json` | метки |
| `status` | `queued` \| `running` \| `succeeded` \| `failed` \| `canceled` |
| `verdict_status`, `verdict_json` | вердикт gate: `passed` \| `failed` \| `invalid`. Это не статус пайплайна |
| `gitlab_pipeline_id`, `gitlab_web_url`, `grafana_url` | |
| `events_json`, `error_message`, `started_at`, `ended_at`, `created_at` | |

## `analysis_runs`

| колонка | смысл |
|---|---|
| `id` | analysis_id |
| `test_run_id` | прогон или пусто |
| `username`, `test_id` | |
| `target_*` | снимок цели |
| `window_from`, `window_to` | период |
| `status` | `queued` \| `running` \| `succeeded` \| `failed` |
| `verdict`, `health_score`, `findings_count`, `headline` | для списка |
| `ruleset_version` | версия `analysis/app/catalog/rules.yaml` |
| `demo`, `demo_fault` | синтетика и какой дефект разыгран |
| `request_json` | вход, чтобы «Пересчитать» повторил тот же запрос |
| `report_json` | отчёт целиком |
| `error_message`, `created_at`, `finished_at` | |

Находки отдельными таблицами не хранятся.

## Потоки

1. Сохранить сборку → `build_id` и `script_id`.
2. Скачать скрипт — тот же `script_id`.
3. Запуск из сборки или upload → новый `run_id`, обязателен `test_id`. Orchestrator пишет файлы в S3 и триггерит GitLab.
4. Анализ по `run_id` или по ручной цели → `analysis_id`. После терминального статуса прогона orchestrator заводит анализ сам, если цель заполнена и включён `analysis/auto-on-finish`.
