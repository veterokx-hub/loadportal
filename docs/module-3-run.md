# Модуль 3 «Запуск»

Создание прогона (`run_id`): заливка скрипта в S3 (SeaweedFS) → trigger GitLab pipeline → статусы по **webhook**. GitLab файлы сценария больше не хранит.

Сервис: **`orchestrator`** (порт **8082**). Общая Postgres и те же Bearer-сессии, что у `constructor`.  
Frontend ходит на same-origin `/api/...`; Next.js проксирует `/api/runs*` и `/api/settings/gitlab*` на orchestrator, остальное — на constructor.

Liquibase и запись сборок/скриптов остаются в constructor; orchestrator только читает `scripts` / `build_records` и пишет `test_runs` / настройки GitLab в `portal_settings`.

## Настройки (admin)

В интерфейсе портала блоков GitLab и LDAP нет. Подключение читается из Consul и Vault, иначе из env, иначе из `portal_settings`:

| Поле | Хранение |
|---|---|
| GitLab base URL, Project ID / path | БД `portal_settings` |
| Репозиторий по умолчанию (`REPOSITORY`) | БД |
| Trigger token, webhook secret, API token | Vault (`loadtest/gitlab/...`), иначе env, иначе БД |
| S3 endpoint, bucket, region | Consul KV `s3/*`, иначе env |
| S3 access/secret key | Vault `loadtest/s3/*`, иначе env |
| Grafana base URL + шаблон dashboard | БД |

Фиксировано в коде (не в UI):

- `ref` = **`master`**
- `TOOL` = `jmeter` \| `k6` \| `gatling` (вместо старых `LOADTEST_ENGINE=…`)
- `REPLICAS` = `1`

Env fallback: `GITLAB_BASE_URL`, `GITLAB_PROJECT_ID`, `GITLAB_REPOSITORY`, `GITLAB_REF`, `GITLAB_TRIGGER_TOKEN`, `GITLAB_WEBHOOK_SECRET`, `GITLAB_API_TOKEN`, `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`. Upload token для запуска больше не нужен.

Публично для авторизованных: `GET /api/settings/gitlab/defaults` → `{ gitlab_repository, configured }`.

## Алгоритм «Запустить тест»

1. Валидация: Jira (`test_id`), скрипт (сборка → сохранённый артефакт или upload), `start_time` / `end_time`.
2. Создать `run` → путь: `scenarios/{test_id}/{portal_run_id}/{filename}`  
   (подпапка на каждый прогон, чтобы артефакты одной Jira не перетирались).  
   Имя релиза в k8s считает CI (`LT_RELEASE_NAME`). `POD_NAME` в pipeline не передаётся.
3. Запись объектов в S3 (SeaweedFS, path-style). ZIP распаковывается в ту же папку ключа. CI получает `S3_MANIFEST_URL` (presigned, 12 ч) и скачивает файлы до pre-check.
4. `POST …/trigger/pipeline` с form:
   - `token`, `ref` (Consul `gitlab/ref`, иначе `master`)
   - `variables[CONTRACT_VERSION]`, `RUN_SPEC_B64` (контракт v1, `scenario.checksum` = sha256 залитого файла), `REPOSITORY`, `RUN_ID`, `TOOL`, `SCENARIO_PATH`, `SCENARIO_CHECKSUM`, `S3_BUCKET`, `S3_MANIFEST_URL`
   - `REPLICAS=1`, `CPU`, `MEMORY`, `START_TIME`, `END_TIME`
   - `PORTAL_RUN_ID` (внутренний id прогона для webhook)
5. Сохранить `gitlab_pipeline_id` / `web_url`; карточка прогона + ссылка Grafana.

При ошибке GitLab прогон сохраняется со статусом `failed` и `error_message`.

## Контракт скрипта и `lt-run`

Раннер не передаёт `--vus` / `--duration` / `--iterations`. Скрипт сам выбирает профиль по режиму. Без переменных CI локальный запуск остаётся `load`: smoke 60 с, `loadFactor` 1.0, базовый URL — из сценария.

| Смысл | k6 (`__ENV`) | Gatling (system property) |
|---|---|---|
| режим | `LT_MODE` = `load` / `smoke` | `lt.mode` = `load` / `smoke` |
| длительность smoke | `LT_SMOKE_DURATION_SEC` | `lt.smokeDurationSec` |
| доля шарда | не нужна (`--execution-segment`) | `loadFactor` (double, 1/N) |
| шард | `LT_SHARD` / `LT_SHARDS` | `shard` / `shards` |
| базовый URL | `BASE_URL` (может отсутствовать) | `baseUrl` (может отсутствовать) |
| метка прогона | тег `testid` ставит раннер | `runId`; `runDescription` перекрывает раннер |

Smoke для k6 и Gatling совпадает с JMeter (TST `const(1, …)`): каждая группа — 1 итерация/с всю длительность. Итерация проходит все запросы группы с `repeat`, корреляцией и датасетами. Ramp, ступени max-search, `target_rps` и `loadFactor` в smoke не применяются. AutoStop выключен: ошибки режет `verdict.py --stage smoke` (порог 0%).

Покрытие «каждый запрос выполнен хотя бы раз» раннер проверяет только у JMeter (разбор JMX). k6 падает сам: threshold `http_reqs{name:<запрос>}` = `count>0`, код выхода 99. Gatling — assertion `details(<запрос>).allRequests().count().gt(0)`. Имена запросов в сценарии уникальны, дубль получает суффикс `#2`, `#3`.

Локально:

```bash
k6 run -e LT_MODE=smoke -e LT_SMOKE_DURATION_SEC=10 script.js
mvn gatling:test -Dlt.mode=smoke -Dlt.smokeDurationSec=10
```

В `load` поведение прежнее, кроме подстановки `BASE_URL` и (Gatling) умножения интенсивностей на `loadFactor`. Сумма шардов равна целевому потоку. Версии Gatling в `pom.xml` не меняются: раннер сверяет их с образом.

## Webhook GitLab

Через Ingress / frontend proxy (рекомендуется):

```
POST https://<portal-host>/api/runs/webhook/gitlab
```

Либо напрямую в orchestrator: `http://orchestrator:8082/api/runs/webhook/gitlab`.

- Заголовок: `X-Gitlab-Token` = webhook secret из настроек
- События: **Pipeline events** родителя. `object_attributes.source = parent_pipeline` игнорируется: дочерний статус уже в родителе (`strategy: depend`)
- Маппинг: GitLab status → `queued|running|succeeded|failed|canceled`
- Идемпотентность по `gitlab_pipeline_id`

## API

| Метод | Путь | Описание |
|---|---|---|
| POST | `/api/runs` | Залить скрипт + trigger + создать TestRun |
| GET | `/api/runs` | Список (свои; admin — все) |
| GET | `/api/runs/{id}` | Карточка прогона |
| POST | `/api/runs/{id}/cancel` | Статус `canceled` и GitLab cancel pipeline (`GITLAB_API_TOKEN`) |
| GET/PUT | `/api/settings/gitlab` | Настройки GitLab (admin) |
| GET | `/api/settings/gitlab/defaults` | REPOSITORY для формы запуска |
| POST | `/api/settings/gitlab/test` | Проверка соединения |

### Тело `POST /api/runs`

| Поле | Обязательно | Описание |
|---|---|---|
| `test_id` | да | Jira → `RUN_ID` |
| `build_id` / `script_id` | один из | Источник скрипта |
| `start_time`, `end_time` | да | ISO-8601 |
| `cpu` | нет | default `2` (2 CPU). Ниже 2 для load CI считает троттлинг |
| `memory` | нет | default `4Gi` |
| `repository` | нет | стенд, default `lt-ump` |
| `engine`, `scenario_name`, `target_url`, `params`, `labels` | нет | метаданные. `engine` — `jmeter`, `k6` или `gatling` |
| `target_cluster`, `target_namespace`, `target_service`, `target_container` | нет | цель для модуля «Анализ» |

## Логирование

Structured console logs (`logback-spring.xml`): HTTP с `username` и `run_id` (MDC).
Ключевые события: upload, trigger, webhook, connection test (без секретов).
