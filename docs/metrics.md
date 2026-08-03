# Метрики портала (VictoriaMetrics)

Каждый backend-модуль отдаёт Prometheus-совместимую экспозицию на **`GET /metrics`**.
Локально их собирает контейнер `victoria-metrics` (порт **8428**).

Это метрики **самой платформы** (сборки, прогоны, логины), а не метрики нагружаемого
стенда — те идут в отдельный Prometheus/Grafana прогона.

## Эндпоинты

| Модуль | URL | Формат |
|---|---|---|
| constructor | http://localhost:8080/metrics | Prometheus text |
| jmeter-builder | http://localhost:8081/metrics | Prometheus text |
| analyzer | http://localhost:8000/metrics | Prometheus text |
| k6-generator | http://localhost:8001/metrics | Prometheus text |
| VictoriaMetrics UI / API | http://localhost:8428 | PromQL |

Scrape-конфиг: [`config/victoria-metrics/scrape.yml`](../config/victoria-metrics/scrape.yml).

## Доменные метрики constructor

| Метрика | Тип | Теги | Зачем |
|---|---|---|---|
| `portal_build_duration_seconds` | histogram | `engine`, `result` | Деградация генерации / доля ошибок |
| `portal_artifact_size_bytes` | summary | `engine` | Аномально большие артефакты |
| `portal_scripts_saved_total` | counter | `engine`, `source` | Сколько скриптов сохраняют (build/upload) |
| `portal_script_size_bytes` | summary | `engine`, `source` | Размер сохранённых скриптов |
| `portal_runs_created_total` | counter | `engine` | Темп создания прогонов |
| `portal_runs_status_total` | counter | `status` | Переходы статусов (queued/running/…) |
| `portal_auth_logins_total` | counter | `method`, `result` | Успешные/неуспешные логины |
| `portal_gitlab_webhooks_total` | counter | `result` | accepted / unknown_pipeline / rejected |
| `portal_builds_stored` | gauge | — | Размер истории сборок |
| `portal_scripts_stored` | gauge | — | Число скриптов в БД |
| `portal_runs_stored` | gauge | — | Всего прогонов |
| `portal_runs_active` | gauge | — | queued + running |

Плюс стандартные `http_server_requests_*`, `http_client_requests_*`, JVM.

## Доменные метрики соседних модулей

**jmeter-builder:** `jmx_build_duration_seconds`, `jmx_artifact_size_bytes`, `jmx_scenario_requests`.

**analyzer:** `analyzer_analyze_*`, `analyzer_fetch_duration_seconds`, `analyzer_draft_requests`.

**k6-generator:** `k6_generate_*`, `k6_artifact_size_bytes`.

## HTTP-клиенты

Внутри каждого модуля HTTP-клиент создаётся **один раз** и переиспользуется:

- constructor — бины `sharedRestClient` / `probeRestClient` (`HttpClientConfig`);
- analyzer — один `httpx.AsyncClient` на lifespan приложения.

Раньше клиент поднимался на каждый запрос / в каждом классе отдельно — это открывало
новый пул TCP и теряло keep-alive.

## Что смотреть в первую очередь

1. `rate(portal_build_duration_seconds_count{result="failure"}[5m])` — растёт ли доля ошибок сборки.
2. `portal_runs_active` vs `rate(portal_runs_created_total[5m])` — создаются ли прогоны, но не уходят из queued (нет вебхуков / trigger).
3. `rate(portal_auth_logins_total{result="failure"}[5m])` — всплеск = сломан LDAP или перебор паролей.
4. `histogram_quantile(0.95, rate(portal_build_duration_seconds_bucket[5m]))` — p95 генерации.
