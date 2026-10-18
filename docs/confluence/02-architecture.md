# Архитектура

## Контекст

Браузер говорит только с frontend. Frontend режет `/api` на constructor и orchestrator. Constructor собирает скрипт через внутренние генераторы и пишет Postgres. Orchestrator кладёт скрипт в S3, триггерит GitLab и принимает webhook. Поды генераторов в кластере НТ бьют по стенду и, если заданы URL, пишут телеметрию в VictoriaMetrics. Модуль анализа читает VictoriaMetrics и складывает отчёт в ту же Postgres.

Снаружи репозитория: Ingress, Argo CD, GitLab-проект нагрузочных тестов, S3, Vault, Consul, VictoriaMetrics, Grafana, LDAP.

## Контейнеры

| Сервис | Порт | Стек | Роль |
|---|---:|---|---|
| frontend | 3000 | Next.js 16, React 19 | UI и same-origin proxy `/api` |
| constructor | 8080 | Java 17, Spring Boot 4.1 | Вход, сценарий, сборка, история, Liquibase |
| orchestrator | 8082 | Java 17, Spring Boot 4.1 | Прогоны, GitLab, webhook, постановка анализа |
| jmeter-builder | 8081 | Java 17, Spring Boot 4.1 | Scenario → `.jmx` |
| analyzer | 8000 | Python 3.12, FastAPI | OpenAPI/Postman → Scenario |
| k6-generator | 8001 | Python 3.12, FastAPI | Scenario → k6 |
| gatling-generator | 8002 | Python 3.12, FastAPI | Scenario → zip Gatling |
| analysis | 8003 | Python 3.12, FastAPI | Метрики → отчёт |
| postgres | 5432 | PostgreSQL 16 | Общая БД constructor и orchestrator |

Генераторы и analysis с браузера не видны. Constructor и orchestrator ходят к ним с заголовком `X-Internal-Token`. В compose порты генераторов опубликованы только на `127.0.0.1`.

## Как режется `/api`

`NEXT_PUBLIC_CORE_API_BASE_URL` пустой: браузер ходит на `/api` того же хоста. Next на сборке прописывает назначения:

| Путь браузера | Куда |
|---|---|
| `/api/runs/*`, `/api/analysis*`, `/api/settings/gitlab*` | orchestrator |
| остальные `/api/*` | constructor |

Webhook GitLab можно пустить Ingress-ом сразу на orchestrator, минуя frontend.

## Поток сценария

```
OpenAPI / Postman / пустой лист
        → analyzer (или UI с нуля)
        → Scenario в браузере (localStorage)
        → constructor /api/builds/save
        → jmeter-builder | k6-generator | gatling-generator
        → build_records + scripts
```

Черновик, который пользователь ещё не сохранил, в БД нет. Он лежит в `localStorage` ключом `ltp-state-v1`.

## Поток прогона

```
POST /api/runs
  → scripts.content в S3
  → GitLab Trigger API, переменная RUN_SPEC_B64, profile=load, replicas=1
  → родительский пайплайн: lint, pre-check, load
  → дочерний пайплайн на подах lt-generators
  → webhook статуса и POST /api/runs/webhook/verdict
  → при заполненной цели и analysis/auto-on-finish — отчёт анализа
```

Портал не передаёт блок SLA. Пороги p95, ошибок и RPS в такой прогон не попадают, пока их не добавят в спецификацию отдельно.

Подробные схемы: `docs/module-3-pipeline.md` и SVG в `docs/module-3-pipeline/`.

## Надёжность границ

- Генератор недоступен: сборка падает в constructor, черновик в браузере остаётся.
- GitLab или S3 не настроены: карточка прогона создаётся и переходит в ошибку. Модуль «Запуск» без них — каркас.
- VictoriaMetrics пустой: анализ работает на синтетике. Галочка «Показать на демо-данных» или Consul `analysis/demo`.
- Postgres одна на constructor и orchestrator. Схему накатывает Liquibase из constructor. Hibernate `ddl-auto: validate`.
