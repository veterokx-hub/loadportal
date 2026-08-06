# Модуль 3 «Запуск»

Создание прогона (`run_id`): заливка скрипта в Git → trigger GitLab pipeline → статусы по **webhook**.

## Настройки (admin)

Раздел **Настройки → GitLab CI**:

| Поле | Хранение |
|---|---|
| GitLab base URL, Project ID / path | БД `portal_settings` |
| Репозиторий по умолчанию (`REPOSITORY`) | БД |
| Trigger token, upload token, webhook secret | БД (позже — Vault); локально — env |
| Grafana base URL + шаблон dashboard | БД |

Фиксировано в коде (не в UI):

- `ref` = **`master`**
- `TOOL` = `jmeter` \| `k6` (вместо старых `LOADTEST_ENGINE=…`)
- `REPLICAS` = `1`

Env fallback: `GITLAB_TRIGGER_TOKEN`, `GITLAB_UPLOAD_TOKEN`, `GITLAB_WEBHOOK_SECRET`.

Публично для авторизованных: `GET /api/settings/gitlab/defaults` → `{ gitlab_repository, configured }`.

## Алгоритм «Запустить тест»

1. Валидация: Jira (`test_id`), скрипт (сборка → сохранённый артефакт или upload), `start_time` / `end_time`.
2. Путь: `auto_lt/{test_id}/{filename}`.
3. Commit файла через Repository Files API (upload token), ветка `master`.
4. `POST …/trigger/pipeline` с form:
   - `token`, `ref=master`
   - `variables[REPOSITORY]`, `RUN_ID`, `TOOL`, `SCENARIO_PATH`, `POD_NAME`
   - `REPLICAS=1`, `CPU`, `MEMORY`, `START_TIME`, `END_TIME`
   - `PORTAL_RUN_ID` (внутренний id прогона для webhook)
5. Сохранить `gitlab_pipeline_id` / `web_url`; карточка прогона + ссылка Grafana.

При ошибке GitLab прогон сохраняется со статусом `failed` и `error_message`.

## Webhook GitLab

```
POST https://<portal-host>/api/runs/webhook/gitlab
```

- Заголовок: `X-Gitlab-Token` = webhook secret из настроек
- События: **Pipeline events**
- Маппинг: GitLab status → `queued|running|succeeded|failed|canceled`
- Идемпотентность по `gitlab_pipeline_id`

## API

| Метод | Путь | Описание |
|---|---|---|
| POST | `/api/runs` | Залить скрипт + trigger + создать TestRun |
| GET | `/api/runs` | Список (свои; admin — все) |
| GET | `/api/runs/{id}` | Карточка прогона |
| DELETE | `/api/builds/{id}` | Удалить сборку (+ связанный `portal_build` скрипт) |
| GET/PUT | `/api/settings/gitlab` | Настройки GitLab (admin) |
| GET | `/api/settings/gitlab/defaults` | REPOSITORY для формы запуска |
| POST | `/api/settings/gitlab/test` | Проверка соединения |

### Тело `POST /api/runs`

| Поле | Обязательно | Описание |
|---|---|---|
| `test_id` | да | Jira → `RUN_ID` |
| `build_id` / `script_id` | один из | Источник скрипта |
| `start_time`, `end_time` | да | ISO-8601 |
| `cpu` | нет | default `500m` |
| `memory` | нет | default `2Gi` |
| `scenario_path`, `pod_name`, `repository` | нет | переопределения |
| `engine`, `scenario_name`, `target_url`, `params`, `labels` | нет | метаданные |

Сценарий 3 (JSON от модуля 2): те же поля API без обязательного UI.

## Логирование

Structured console logs (`logback-spring.xml`): HTTP с `username` и `run_id` (MDC).
Ключевые события: upload, trigger, webhook, connection test (без секретов).
