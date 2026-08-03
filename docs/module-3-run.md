# Модуль 3 «Запуск»

Создание прогона (`run_id`) по сборке или загруженному скрипту. Статус обновляется **webhook** GitLab.
Вызов Trigger Pipeline API будет подключён к кнопке «Запустить тест».

## Настройки (admin)

Раздел **Настройки → GitLab CI**:

| Поле | Хранение |
|---|---|
| GitLab base URL, project, ref | БД `portal_settings` |
| Переменные CI для jmeter/k6 | БД |
| Vault path trigger token / webhook secret | БД (только путь) |
| Grafana base URL + шаблон dashboard | БД |

Секреты **не** вводятся в UI. Prod: **Vault KV**. Локально: env `GITLAB_TRIGGER_TOKEN`, `GITLAB_WEBHOOK_SECRET`.

## Webhook GitLab

```
POST https://<portal-host>/api/runs/webhook/gitlab
```

- Заголовок: `X-Gitlab-Token` = webhook secret из Vault
- События: **Pipeline events**
- Маппинг: GitLab status → `queued|running|succeeded|failed|canceled`
- Идемпотентность по `gitlab_pipeline_id`

## API прогонов

| Метод | Путь | Описание |
|---|---|---|
| POST | `/api/runs` | Создать TestRun (queued; trigger — позже) |
| GET | `/api/runs` | Список (свои; admin — все) |
| GET | `/api/runs/{id}` | Карточка прогона |
| GET/PUT | `/api/settings/gitlab` | Настройки GitLab (admin) |
| POST | `/api/settings/gitlab/test` | Проверка соединения |

Планируемые trigger variables: `LOADTEST_RUN_ID`, `ENGINE`, `TARGET_URL`, `ARTIFACT_BUILD_ID`, `PARAM_*`, `LABEL_*`.

## Логирование

Structured console logs (`logback-spring.xml`): HTTP с `username` и `run_id` (MDC).
Ключевые события: webhook, connection test (без секретов).
