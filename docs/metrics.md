# Метрики портала

Каждый backend-модуль отдаёт Prometheus-совместимую экспозицию на **`GET /metrics`**.
Сбор выполняет внешняя (собственная) VictoriaMetrics/Prometheus-инсталляция —
контейнер сборщика в репозитории не поставляется, добавьте эндпоинты ниже
в свой scrape-конфиг.

Это метрики **самой платформы** (сборки, прогоны, логины), а не метрики нагружаемого
стенда — те идут в отдельный Prometheus/Grafana прогона.

## Эндпоинты

| Модуль | URL | Формат |
|---|---|---|
| constructor | http://localhost:8080/metrics | Prometheus text |
| orchestrator | http://localhost:8082/metrics | Prometheus text |
| jmeter-builder | http://localhost:8081/metrics | Prometheus text |
| analyzer | http://localhost:8000/metrics | Prometheus text |
| k6-generator | http://localhost:8001/metrics | Prometheus text |
| gatling-generator | http://localhost:8002/metrics | Prometheus text |
| analysis | http://localhost:8003/metrics | Prometheus text |

## Доменные метрики constructor

| Метрика | Тип | Теги | Зачем |
|---|---|---|---|
| `portal_build_duration_seconds` | histogram | `engine`, `result` | Деградация генерации / доля ошибок |
| `portal_artifact_size_bytes` | summary | `engine` | Аномально большие артефакты |
| `portal_scripts_saved_total` | counter | `engine`, `source` | Сколько скриптов сохраняют (build/upload) |
| `portal_script_size_bytes` | summary | `engine`, `source` | Размер сохранённых скриптов |
| `portal_auth_logins_total` | counter | `method`, `result` | Успешные/неуспешные логины |
| `portal_builds_stored` | gauge | — | Размер истории сборок |
| `portal_scripts_stored` | gauge | — | Число скриптов в БД |
| `portal_runs_stored` | gauge | — | Всего прогонов (gauge по общей БД) |
| `portal_runs_active` | gauge | — | queued + running |

## Доменные метрики orchestrator

| Метрика | Тип | Теги | Зачем |
|---|---|---|---|
| `portal_runs_created_total` | counter | `engine` | Темп создания прогонов |
| `portal_runs_status_total` | counter | `status` | Переходы статусов (queued/running/…) |
| `portal_gitlab_webhooks_total` | counter | `result` | accepted / unknown_pipeline / rejected / ignored / canceled_kept |
| `portal_analysis_duration_seconds` | timer | `trigger`, `verdict` | Длительность анализа: ручной запуск vs автозапуск по завершении |

Плюс стандартные `http_server_requests_*`, `http_client_requests_*`, JVM.

## Доменные метрики соседних модулей

**jmeter-builder:** `jmx_build_duration_seconds`, `jmx_artifact_size_bytes`, `jmx_scenario_requests`.

**analyzer:** `analyzer_analyze_*`, `analyzer_fetch_duration_seconds`, `analyzer_draft_requests`.

**k6-generator:** `k6_generate_*`, `k6_artifact_size_bytes`.

**gatling-generator:** `gatling_generate_*`, `gatling_artifact_size_bytes` (формат всегда `zip`).

**analysis** (имена как в `analysis/app/metrics.py`, без суффикса `_total` у гистограмм):

| Метрика | Тип | Теги | Зачем |
|---|---|---|---|
| `analysis_duration_seconds` | histogram | `mode`, `result` | Сколько занимает разбор; `mode` = `live` / `demo` |
| `analysis_total` | counter | `mode`, `verdict` | Распределение вердиктов. `verdict=error` — анализ упал |
| `analysis_findings_total` | counter | `severity`, `detector` | Какой детектор шумит |
| `analysis_source_queries` | histogram | — | Сколько запросов в VictoriaMetrics на один анализ |
| `analysis_source_points` | histogram | — | Сколько точек забрано за прогон |
| `analysis_coverage_score` | histogram | — | Покрытие каталога, проценты. Низкое значение значит, что вердикт «чисто» ни о чём |

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
5. `histogram_quantile(0.5, rate(analysis_coverage_score_bucket[1h]))` — медианное покрытие метрик. Просело — сломался каталог или доступ к источнику, а отчёты продолжают показывать «всё чисто».
