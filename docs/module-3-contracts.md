# Контракты взаимодействия пайплайна НТ

Границы, по которым системы передают данные. Нормативная схема входа в CI — [`ci-runner/contracts/run-spec.schema.json`](../ci-runner/contracts/run-spec.schema.json), версия `contract_version = 1`. Остальные контракты ниже собраны по коду, который их читает и пишет.

Общий секрет портала и GitLab — заголовок `X-Gitlab-Token`. Им закрыты `POST /api/runs/webhook/gitlab` и `POST /api/runs/webhook/verdict`. Значение лежит в Vault `loadtest/gitlab/...` или в переменной проекта `LT_PORTAL_CALLBACK_TOKEN`. В лог токен не пишется.

Дочерний пайплайн не видит переменные триггера. `LT_PORTAL_CALLBACK_*`, `LT_VAULT_*`, `LT_INFLUX_URL`, `K6_PROMETHEUS_RW_*` задаются на проекте GitLab.

## 1. Портал → GitLab Trigger API

`POST /api/v4/projects/:id/trigger/pipeline`, form-data.

| Поле | Кто кладёт | Смысл |
|---|---|---|
| `token` | trigger token проекта | не API-токен; отмена им невозможна |
| `ref` | настройки GitLab портала | ветка пайплайна НТ |
| `variables[RUN_SPEC_B64]` | launcher | JSON контракта v1, base64 UTF-8 |
| `variables[S3_MANIFEST_URL]` | launcher | presigned GET манифеста SeaweedFS |
| `variables[PORTAL_RUN_ID]` | launcher | UUID прогона. Webhook ищет его в переменных пайплайна |
| `variables[TOOL]` | launcher | `jmeter` / `k6` / `gatling` |
| `variables[SCENARIO_PATH]` | launcher | ключ основного файла в S3 |
| `variables[SCENARIO_CHECKSUM]` | launcher | sha256 содержимого основного файла |
| `variables[REPOSITORY]` | launcher | логический стенд |
| `variables[CPU]` `variables[MEMORY]` | launcher | ресурсы одного пода |
| `variables[REPLICAS]` | launcher | сейчас всегда `1` |
| `variables[START_TIME]` `variables[END_TIME]` | launcher | окно прогона |
| `variables[RUN_ID]` | launcher | `testId`, в контракт попадает как `run.jira`, если это ключ задачи |
| `variables[CONTRACT_VERSION]` | launcher | `1` |
| `variables[S3_BUCKET]` | launcher | имя бакета, pre-check его не читает |

CI читает спецификацию в таком порядке: файл `--spec-file`, затем `RUN_SPEC_B64`, затем `RUN_SPEC` (сырой JSON), затем плоские переменные. Для портала срабатывает `RUN_SPEC_B64`.

Что launcher кладёт в JSON:

| Поле | Значение |
|---|---|
| `contract_version` | `1` |
| `run.tool` | движок |
| `run.trigger` | `portal` |
| `run.profile` | `load` |
| `run.portal_run_id` | UUID |
| `run.jira` | только если `testId` матчит `^[A-Z][A-Z0-9]*-[0-9]+$` |
| `run.name` | имя сценария, до 200 символов |
| `scenario.source` | `s3` |
| `scenario.path` | ключ файла |
| `scenario.checksum` | `sha256:` и 64 hex-символа SHA-256 основного файла |
| `target.repository` | стенд |
| `target.base_url` | только если URL начинается с `http://` или `https://` |
| `resources` | `cpu`, `memory`, `replicas: 1` |
| `schedule` | `start` и `end`, если оба заданы |
| `meta.requested_by` | имя пользователя |

Блока `sla` launcher не шлёт. `run.smoke` не шлёт, CI берёт `auto`.

`S3ScriptStore` кладёт в `Stored.checksum` строку `sha256:` плюс hex. Её же launcher пишет и в `scenario.checksum`, и в `SCENARIO_CHECKSUM`. Это совпадает со схемой. Плоский путь CI дополнительно принимает голый hex и сам дописывает префикс.

## 2. RUN_SPEC v1

Корень: обязательны `contract_version`, `run`, `scenario`, `target`. Лишние поля запрещены.

### run

| Поле | Ограничение |
|---|---|
| `tool` | `jmeter` \| `k6` \| `gatling` |
| `trigger` | `portal` \| `dev-pipeline` \| `manual` |
| `profile` | `smoke` \| `qg` \| `load` \| `max-search`. По умолчанию `load` |
| `smoke` | `auto` \| `always` \| `never`. По умолчанию `auto`: стадия smoke есть у `load` и `max-search`, нет у `qg`. Профиль `smoke` включает стадию всегда |
| `portal_run_id` | UUID. Обязателен при `trigger=portal` |
| `jira` | ключ задачи. Обязателен при `load` и `max-search` |
| `name` | до 200 символов |

### scenario

| Поле | Ограничение |
|---|---|
| `source` | в схеме `git` \| `portal` \| `s3`. Этот CI исполняет только `git` и `s3`. `portal` — код выхода 3 |
| `path` | относительный, без `..` и без ведущего `/` |
| `checksum` | `sha256:` + 64 hex. Сверяется с файлом после скачивания |
| `entrypoint` | файл внутри zip. Для Gatling класс берётся из `pom.xml` |
| `shardable` | `true`, если `replicas > 1`. Иначе pre-check отклоняет прогон |
| `datasets[]` | до 50 элементов `{path, checksum?}` |

Расширение пути: JMeter `.jmx` или `.zip`, k6 `.js` или `.zip`, Gatling только `.zip`.

`git` — файл уже в checkout репозитория НТ. `s3` — файл должен появиться до проверки, его кладёт `ci/fetch-s3.sh`.

### target

| Поле | Ограничение |
|---|---|
| `repository` | `^[a-z0-9][a-z0-9-]{0,62}$` |
| `base_url` | URI, до 2048 |
| `environment` | `dev` \| `test` \| `stage` \| `preprod`. `prod` в перечислении нет |

### load, resources, schedule, sla

`load`: `rps`, `users`, `duration_sec` (1…86400), `ramp_up_sec`. Окно либо из `schedule.start`/`end`, либо из `load.duration_sec`.

`resources`: `cpu` (`2` или `500m`), `memory` (`4Gi`, `4096Mi`, …), `replicas` 1…50. Дочерний пайплайн ставит requests = limits.

`schedule`: RFC 3339. Без смещения применяется `LT_DEFAULT_TZ` (`Europe/Moscow`).

`sla`: `p95_ms`, `p99_ms` — целые ≥ 1; `error_rate_pct` — 0…100; `min_rps` — больше 0. Для профиля `qg` блок обязателен.

`secrets[]`: до 8 объектов `{name, vault}`. `name` — `^[A-Z][A-Z0-9_]{0,31}$`, в под попадает как `LT_SECRET_<name>`. `vault` — `path@engine`, например `loadtest/payments/TOKEN@kv`. Значений в контракте нет.

`telemetry.run_label` — метка метрик, `^[a-zA-Z0-9_:-]{1,64}$`. Если пусто, CI собирает её из jira и короткого id.

`meta`: `requested_by`, `source_project`, `source_branch`, `source_commit` (7…40 hex), `source_pipeline_url`, `build_number`, `release_version`.

### Политики поверх схемы

| Правило | Следствие |
|---|---|
| длительность | smoke ≤ 900 с, qg ≤ 1800 с, load и max-search ≤ 28800 с |
| окно в прошлом больше 300 с | отказ |
| старт позже `LT_MAX_START_LAG_SEC` (900) | отказ |
| `load` / `max-search` и cpu < 2000m или memory < 4096Mi | предупреждение; при `LT_RESOURCE_POLICY=strict` отказ |
| `preprod` и профиль `load` или `max-search` | предупреждение |
| каталог сценария | не больше 50 МБ, копируется в артефакт pre-check |

Коды pre-check: `0` прогон допустим, `2` контракт или политика, `3` окружение (нет схемы, нет файла из S3, нет Vault URL при непустом `secrets`).

## 3. Плоские переменные и шаблон QG

Если нет `RUN_SPEC_B64` и `RUN_SPEC`, pre-check собирает спецификацию из окружения.

Обязательны `TOOL`, `SCENARIO_PATH`, `REPOSITORY`. Источник `s3`, если задан `S3_MANIFEST_URL`, иначе `git`. `trigger=portal`, если есть `PORTAL_RUN_ID`, иначе `manual`.

| Переменная | Поле |
|---|---|
| `PROFILE` | `run.profile`, по умолчанию `load` |
| `PORTAL_RUN_ID` | `run.portal_run_id` |
| `RUN_ID` | `run.jira` |
| `BASE_URL` | `target.base_url` |
| `SCENARIO_CHECKSUM` | `scenario.checksum`, префикс `sha256:` добавляется |
| `CPU` `MEMORY` `REPLICAS` | `resources` |
| `START_TIME` и `END_TIME` | `schedule`, только вместе |

`LT_QG=1` переписывает эту сборку. Другое значение `LT_QG` — отказ.

| После `LT_QG=1` | Откуда |
|---|---|
| `trigger=dev-pipeline`, `profile=qg`, `smoke=never` | фиксировано |
| `target.environment` | `ENVIRONMENT`, иначе `test` |
| `load.duration_sec` | `DURATION_SEC`, иначе 600 |
| `load.rps` | `RPS` |
| `sla` | хотя бы одно из `SLA_P95_MS`, `SLA_P99_MS`, `SLA_ERROR_RATE_PCT`, `SLA_MIN_RPS` |
| `resources` | `CPU` иначе `1`, `MEMORY` иначе `2Gi`, `replicas` только 1 |
| `secrets` | `LT_QG_SECRETS`: `NAME=path@engine` через запятую |
| `meta` | `SOURCE_PROJECT`, `SOURCE_BRANCH`, `SOURCE_COMMIT`, `SOURCE_PIPELINE_URL`, `BUILD_NUMBER` |

Продуктовый include `ci-runner/lt-ci-templates/qg.yml` передаёт в проект НТ ровно эти имена. Свои переменные продукта не форвардятся (`forward.pipeline_variables: false`). Обязательные переменные продукта: `LT_QG_TOOL`, `LT_QG_SCENARIO`, `LT_QG_REPOSITORY`, `LT_QG_BASE_URL` и один порог `LT_QG_P95_MS` / `LT_QG_P99_MS` / `LT_QG_ERROR_RATE_PCT` / `LT_QG_MIN_RPS`.

Ответ продукта — статус мультипроектного trigger со `strategy: depend`. Код gate `0` оставляет продукт зелёным. Коды `1` и `2` оба красные.

## 4. S3-манифест

`S3_MANIFEST_URL` — presigned GET, TTL 12 часов. URL в лог не пишется.

Тело — текст, одна запись на строку, поля через таб:

```text
<ключ объекта>	<presigned GET этого объекта>
```

Ключ относительный: без ведущего `/` и без `..`. Пустой манифест — отказ, код 2. Сетевая ошибка скачивания — код 3. `checksum` в RUN_SPEC считается по основному файлу сценария, не по манифесту.

## 5. Pre-check → остальные джобы

Артефакт `.nt/`:

| Файл | Контракт |
|---|---|
| `run.json` | исходный RUN_SPEC плюс объект `computed` |
| `run.env` | плоский файл для `source`. Не dotenv GitLab |
| `scenario/` | замороженная копия каталога сценария |
| `child.yml` | дочерний пайплайн. Его не правят руками |

`computed`: `short_id`, `run_label`, `shards`, `smoke` (`enabled`, `mode`, `budget_sec`, `duration_sec`, `max_error_pct`), `scenario.local_path`, `scenario.sha256`, `schedule` (UTC и epoch начала и конца, `duration_sec`, `start_lag_sec`, `job_timeout_sec`), `resources`, `ci`, `generated_at`.

`run.env` отдаёт генератору `LT_TOOL`, `LT_PROFILE`, `LT_TRIGGER`, `LT_PORTAL_RUN_ID`, `LT_RUN_LABEL`, `LT_SCENARIO_LOCAL`, `LT_ENTRYPOINT`, `LT_SHARDS`, `LT_BASE_URL`, `LT_CPU`, `LT_MEMORY`, `LT_START_EPOCH`, `LT_DURATION_SEC`, `LT_SMOKE_BUDGET_SEC`, `LT_SMOKE_DURATION_SEC`, пороги `LT_SLA_*`. Секретов и presigned URL там нет.

## 6. Генератор → инструмент

`lt-run` читает `.nt/run.env` и `LT_MODE` (`load` или `smoke`). Доля шарда `load_factor = 1/N`. Код выхода `lt-run`: `0` итоги есть, `4` шард невалиден. Нарушение SLA этот код не выражает.

Секреты уже в окружении как `LT_SECRET_*`. В `-J`, `-e` и `-D` они не передаются.

| Смысл | JMeter, свойство `-J` | k6, `-e` | Gatling, `-D` |
|---|---|---|---|
| режим | `lt.mode` | `LT_MODE` | `lt.mode` |
| доля шарда | `load_factor` | execution segment | `loadFactor` |
| номер шарда | `shard`, `shards` | `LT_SHARD`, `LT_SHARDS` | `shard`, `shards` |
| id прогона | `runId` | `LT_RUN_ID` | `runId` |
| метка | `run_label` | тег `testid` | `gatling.core.runDescription` |
| базовый URL | `base_url`, только если непустой | `BASE_URL` | `baseUrl` |
| длительность smoke | `load_profile=const(1,<сек>s)` | `LT_SMOKE_DURATION_SEC` | `lt.smokeDurationSec` |

Пустые `base_url` и `influxdb_url` в JMeter не передаются: пустое свойство затёрло бы дефолт `${__P(...)}` в скрипте.

Рядом со скриптом k6 может лежать `vm.json`: `server_url`, `bearer_token`, `trend_stats`. Явные `K6_PROMETHEUS_RW_SERVER_URL` и `LT_INFLUX_URL` перекрывают `server_url`. Токен попадает в `K6_PROMETHEUS_RW_BEARER_TOKEN` и в аргументы k6 не попадает.

Итог шарда, каталог `results/smoke/` или `results/shard-<N>/`:

| Файл | Кто пишет |
|---|---|
| `meta.json` | `lt-run`: `mode`, `shard`, `shards`, `tool`, `tool_exit_code`, `error`, времена, pod, `ci_job_id` |
| `kpi.jtl` | JMeter через Taurus |
| `summary.json` | k6, `--summary-export`, статистика включая `p(95)` и `p(99)` |
| `global_stats.json` | Gatling. `percentiles3` — p95, `percentiles4` — p99 |

## 7. Генератор → VictoriaMetrics

Запись есть только если задан адрес. Gate эти ряды не читает.

| Инструмент | Куда | Условие |
|---|---|---|
| JMeter | Influx line protocol, свойство `influxdb_url` | `LT_INFLUX_URL`, например `http://vm:8428/write?db=jmeter` |
| k6 | Prometheus remote write, `-o experimental-prometheus-rw` | `vm.json`, либо `LT_INFLUX_URL` (путь `/write` переписывается в `/api/v1/write`, параметр `db` отбрасывается), либо `K6_PROMETHEUS_RW_SERVER_URL` |
| Gatling | нет вызова из `lt-run` | — |

Метка прогона для Grafana: JMeter `runId` / `run_label`, k6 тег `testid=<LT_RUN_LABEL>`.

## 8. Vault → под генератора

Только джобы `smoke` и `generate`. `gate` и `publish` секретов не видят.

Нужны переменные проекта `LT_VAULT_SERVER_URL` (`https://хост[:порт]`), `LT_VAULT_AUTH_ROLE` (по умолчанию `lt-ci`), `LT_VAULT_AUTH_PATH` (по умолчанию `jwt`). Джоба объявляет `id_tokens.LT_VAULT_ID_TOKEN` с `aud` равным URL Vault и блок `secrets` GitLab:

```yaml
LT_SECRET_<NAME>:
  vault: "<path>@<engine>"
  file: false
  token: $LT_VAULT_ID_TOKEN
```

`file: false` — значение в переменной окружения, не в файле. Под в Vault не ходит: секрет резолвит runner.

## 9. Gate → артефакт и портал

`python3 ci/lib/verdict.py --manifest .nt/run.json --results results`.

Пишет `results/verdict.json` и `results/junit.xml`. Код процесса: `passed` → 0, `failed` → 1, `invalid` → 2. Приоритет статуса: `invalid`, затем `failed`, затем `passed`.

`verdict.json`:

| Поле | Смысл |
|---|---|
| `status` | `passed` \| `failed` \| `invalid` |
| `tool`, `portal_run_id`, `run_label`, `shards` | из манифеста |
| `metrics.samples` | число запросов |
| `metrics.p95_ms`, `metrics.p99_ms` | JMeter — точные по всем сэмплам JTL. k6 и Gatling — готовые перцентили; при нескольких шардах максимум, `metrics.exact=false` |
| `metrics.error_rate_pct` | ошибки / samples × 100 |
| `metrics.rps` | сумма RPS шардов |
| `checks[]` | `{name, op, limit, actual, status}` по полям `sla` |
| `shard_results[]` | статус каждого шарда и `reason` |
| `smoke` | оценка стадии smoke, если она была |
| `reasons[]` | строки для человека |

Сравнение SLA: p95, p99 и доля ошибок — не выше порога (`<=`), RPS — не ниже (`>=`). Нет фактического числа при заданном пороге — `invalid`. Нет ни одного сэмпла — `invalid`.

Код инструмента сам красит шард: JMeter `3` и k6 `99` — `failed` (порог инструмента). Gatling с ненулевым кодом и уже записанными итогами — `failed`. Прочий ненулевой код и отсутствие файла итогов — `invalid`.

Smoke перед нагрузкой не проверяет SLA по задержке. Нужны код 0, ошибки не выше `LT_SMOKE_MAX_ERROR_PCT` (0) и хотя бы один сэмпл. У JMeter имена включённых HTTP-сэмплеров из JMX должны встретиться в JTL. Провал smoke при профиле `smoke` — это `failed` или статус smoke. Провал smoke перед нагрузкой — `invalid`, нагрузки не было.

`junit.xml`: один `testsuite`. `failed` → `<failure>`, `invalid` → `<error>`. GitLab показывает его как отчёт джобы `gate`.

Если `smoke-check` упал, `generate` не стартует. `gate` зависит от артефактов `generate` без `optional`, поэтому `gate` и `publish` тоже не стартуют. `verdict.json` в этом случае нет.

### Publish

`POST` тела `verdict.json` на `LT_PORTAL_CALLBACK_URL`.

Заголовки: `Content-Type: application/json`, `X-Gitlab-Token: LT_PORTAL_CALLBACK_TOKEN`. Таймаут 20 с.

| Условие | Код publish |
|---|---|
| URL пуст | 0, вердикт остаётся в артефактах |
| URL есть, токена нет | 1 |
| нет файла, битый JSON, нет `portal_run_id` или `status` | 1 |
| HTTP-ошибка или сеть | 1 |

Джоба `allow_failure: true`. Код 1 не меняет статус gate.

Ответ портала: `200 {"status":"ok"}` или `200 {"status":"ignored"}`. `ignored` — прогон уже `CANCELED`, вердикт не перезаписывается. Повтор с тем же статусом и тем же JSON тоже `ok`.

`403 {"error":"invalid token"}` — секрет не совпал. Неизвестный `status`, не-UUID или неизвестный прогон — ошибка разбора, портал отвечает 400/404 по своему обработчику.

Запись в прогон:

| `status` | `test_runs` |
|---|---|
| `passed` | `SUCCEEDED`, `error_message` пустой, `verdict_status=passed` |
| `failed` | `FAILED`, в ошибку пишутся `reasons` через `; `, иначе «SLA не пройден» |
| `invalid` | `FAILED`, в ошибку пишутся `reasons`, иначе «прогон недостоверен» |

Полный JSON остаётся в `verdict_json`. В API карточки наружу выходит урезанный `RunVerdictDto`: `status`, `samples`, `p95_ms`, `p99_ms`, `error_rate_pct`, `rps`, `reasons`.

Publish анализ не запускает.

## 10. GitLab → портал, webhook пайплайна

GitLab шлёт Pipeline Hook на `POST /api/runs/webhook/gitlab` с тем же `X-Gitlab-Token`.

Портал читает:

| Поле тела | Использование |
|---|---|
| `object_kind` | обрабатывается только `pipeline`, иначе `{"status":"ignored"}` |
| `object_attributes.source` | `parent_pipeline` игнорируется: это дочерний пайплайн, своего `PORTAL_RUN_ID` у него нет |
| `object_attributes.id` | id пайплайна родителя |
| `object_attributes.status` | статус GitLab |
| `object_attributes.url` | ссылка на пайплайн |
| `object_attributes.variables[]` | элементы `{key, value}`. Берутся `PORTAL_RUN_ID` или `LOADTEST_RUN_ID` |

Прогон ищется по id пайплайна. UUID из переменных принимается, только если пайплайн совпал или у прогона id ещё не записан.

| Статус GitLab | Статус прогона |
|---|---|
| `created`, `waiting_for_resource`, `preparing`, `pending`, `scheduled` | `QUEUED` |
| `running` | `RUNNING` |
| `success` | `SUCCEEDED` |
| `failed` | `FAILED` |
| `canceled`, `cancelled`, `skipped` | `CANCELED` |
| иное и пустое | `QUEUED` |

`success` и `failed` не различают `invalid` и нарушение SLA. Это делает контракт вердикта из раздела 9.

На терминальном статусе, если у прогона заполнен target service, портал один раз ставит автоанализ. Анализ читает метрики сервиса из VictoriaMetrics, не файлы генератора.

Отмена прогона из UI — отдельный вызов GitLab API `cancel` с API-токеном, не с trigger token. Под генератора получает SIGTERM, `lt-run` дописывает `meta.json`.
