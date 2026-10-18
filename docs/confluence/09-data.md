# Данные

Полные колонки: `docs/data-model-ids.md`. Схема: Liquibase, `constructor/src/main/resources/db/changelog/db.changelog-master.yaml`. Hibernate только проверяет, что схема совпала (`ddl-auto: validate`).

Таблиц `projects` и `scenarios` нет. Сценарий — JSON в `build_records.scenario_json`.

## Цепочка

```
build_id → script_id → run_id → analysis_id
                test_id (Jira) на прогоне
```

| ID | Таблица | Смысл |
|---|---|---|
| `build_id` | `build_records.id` | Снимок сценария и движок |
| `script_id` | `scripts.id` | Файл `.jmx` / k6 / zip |
| `test_id` | `test_runs.test_id` | Ключ Jira, в GitLab это `RUN_ID` |
| `run_id` | `test_runs.id` | Прогон, в webhook это `PORTAL_RUN_ID` |
| `analysis_id` | `analysis_runs.id` | Отчёт. `test_run_id` пустой, если цель ввели руками |

## Сроки

История сборок: 30 штук на пользователя, 30 дней, cron constructor `0 15 3 * * *`. Ключи в `config/consul-vault-config.yaml`: `loadtest.builds.retention-days`, `cleanup-enabled`, `cleanup-cron`. Удаление сборки удаляет связанный скрипт с `source=portal_build`.

Прогоны и отчёты этим cron не чистятся. Тело скрипта лежит в `scripts.content` и на время прогона копируется в S3.

## `scripts.source`

`portal_build` — собрал портал. `upload` — пользователь загрузил готовый `.jmx`, `.js`, `.ts` или `.zip`. У upload `build_id` пустой. Колонка `git_url` есть, запуск в git сценарий не кладёт.

## Статусы прогона

`queued`, `running`, `succeeded`, `failed`, `canceled`.

`verdict_status` отдельно: `passed`, `failed`, `invalid`. Это ответ gate, не цвет GitLab. Прогон может быть `failed` из-за упавшего родителя и при этом без `verdict_json`, если publish не вызывался (провал smoke, ошибка pre-check, отмена).

## Статусы анализа

`queued`, `running`, `succeeded`, `failed`.

Находки отдельной таблицей не хранятся: весь отчёт в `report_json`. `request_json` нужен кнопке «Пересчитать»: создаётся новая строка, старая не переписывается. `ruleset_version` — версия `analysis/app/catalog/rules.yaml` на момент расчёта. `demo` и `demo_fault` помечают синтетику.

## Что где ещё лежит

| Данные | Где | Чего там нет |
|---|---|---|
| Черновик до сохранения | `localStorage` `ltp-state-v1` | Нет на сервере. Чистка браузера его стирает |
| Сессия | `auth_sessions`, TTL 3 часа | Пароль не в токене |
| Пользователи | Postgres | Пароли только хеш |
| Настройки GitLab и LDAP | Consul KV, запасной слой `portal_settings` | Секреты в KV не класть |
| Скрипт на время прогона | S3, бакет из `s3/bucket` | После прогона источник истины для скачивания из UI — `scripts.content` |
| Телеметрия | VictoriaMetrics | Портал её не хранит |

Одна база на constructor и orchestrator. Имя локально `loadtest`, пользователь `loadtest`, JDBC из yaml или Consul `loadtest.postgres.url`.
