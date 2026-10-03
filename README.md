# Load Test Portal (НТ · Портал)

Портал подготовки и запуска сценариев нагрузочного тестирования:
**OpenAPI / Postman / чистый лист → JMeter `.jmx` / k6 / Gatling zip → прогон через GitLab CI → разбор метрик**.

Окружение: **один прод-экземпляр** в тестовом k8s-кластере. Манифесты k8s / Argo — **вне репозитория**.
Здесь — исходники сервисов, `docker-compose.yml` для локальной разработки и эталон
`config/consul-vault-config.yaml` для ConfigMap.

## Статус модулей

| Модуль | UI | Состояние |
|---|---|---|
| **Сценарий** | `/scenario/*` | Готов: разбор спецификации, параметры, корреляция, сборка JMeter/k6/Gatling, история |
| **Стенд** | `/environment` | Заглушка, экрана развёртывания нет |
| **Запуск** | `/run/*` | Карточки прогонов и триггер GitLab есть. Прогон доходит до конца, только если настроены CI и секреты |
| **Анализ** | `/analysis/*` | Готов: отчёт по прогону, ссылке Grafana или ручной цели |
| **Отчёт** | `/report` | Заглушка, PDF и Confluence нет |

Запуск: [`docs/module-3-run.md`](docs/module-3-run.md). Анализ: [`docs/module-4-analysis.md`](docs/module-4-analysis.md).

## Архитектура

| Сервис | Порт | Стек | Назначение |
|---|---:|---|---|
| `frontend` | 3000 | Next.js 16 / React 19 | UI портала; same-origin `/api` + rewrites |
| `constructor` | 8080 | Java 17 / Spring Boot 4.1 | Auth, сценарий, история, Liquibase |
| `orchestrator` | 8082 | Java 17 / Spring Boot 4.1 | Запуск прогонов, GitLab CI, webhook |
| `jmeter-builder` | 8081 | Java 17 / Spring Boot 4.1 | Scenario → `.jmx` |
| `analyzer` | 8000 | Python 3.12 / FastAPI | OpenAPI/Postman → Scenario |
| `k6-generator` | 8001 | Python 3.12 / FastAPI | Scenario → k6 |
| `gatling-generator` | 8002 | Python 3.12 / FastAPI | Scenario → Gatling (zip Maven-проекта) |
| `analysis` | 8003 | Python 3.12 / FastAPI | Метрики прогона → аномалии, корреляции, гипотезы |
| `postgres` | 5432 | PostgreSQL 16 | Пользователи, сборки, скрипты, прогоны, отчёты анализа |

Контейнер VictoriaMetrics **не поставляется** — метрики модулей (`GET /metrics`) скрейпит
ваша внешняя VictoriaMetrics / Prometheus. См. [`docs/metrics.md`](docs/metrics.md).

```
Browser ──► frontend (:3000)
              /           → UI
              /api/runs*  → orchestrator (:8082)
              /api/analysis* → orchestrator ──► analysis (:8003) ──► VictoriaMetrics
              /api/settings/gitlab* → orchestrator
              /api/*      → constructor (:8080)
                              ├─► jmeter-builder
                              ├─► analyzer
                              ├─► k6-generator
                              ├─► gatling-generator
                              └─► PostgreSQL (общая с orchestrator)
```

Адреса модулей, Consul и Vault — в **`config/consul-vault-config.yaml`** (ConfigMap).  
Секреты (БД, bootstrap-admin, LDAP bind, GitLab tokens) — **Vault / env**, не ConfigMap и не git.

## Как пользоваться (модуль «Сценарий»)

1. **Источник** (`/scenario/source`)
   - Swagger/OpenAPI (URL или вставка JSON/YAML)
   - Postman Collection (JSON)
   - **С чистого листа** — пустой сценарий без спецификации
   - Можно **подтянуть** сохранённую сборку из истории
2. **Запросы** (`/scenario/requests`)
   - Базовый URL, список методов/путей
   - Ручное добавление запросов
   - Опциональный **собственный абсолютный URL** на запрос (переопределяет `base_url` + `path`)
3. **Корреляция и параметры** (`/scenario/correlation`)
   - Источники значений: константа, генератор, CSV, корреляция из ответа
   - Вкладка Body: тело запроса; фрагменты `{name}` становятся параметрами Body
   - Датасеты CSV на уровне сценария, привязка к запросу
4. **Интенсивность и сборка** (`/scenario/intensity`)
   - Режимы: постоянная нагрузка (`ramp_hold`) / поиск максимума (`max_search`)
   - Группы запросов (корреляция + общий CSV), дробный RPS (например `0.01`)
   - Движок: **JMeter**, **k6** или **Gatling**
   - Сохранить сборку / выгрузить скрипт / перейти к запуску
   - История сборок (последние 30, TTL 30 дней; в UI видны ~3 строки со скроллом)

Перед заменой сценария («Новый сценарий», подтягивание старой сборки) UI предлагает
сохранить текущую сборку. Сохранение доступно даже при замечаниях в «Пульсе сценария».

История сборок: до 30 на пользователя; TTL-cron в constructor (`loadtest.builds.*` в ConfigMap):
`retention-days`, `cleanup-enabled`, `cleanup-cron` (по умолчанию ежедневно в 03:15).

### Запуск (частично)

`/run/new` — создать прогон из сохранённой сборки или загруженного скрипта.  
`/run/list`, `/run/{id}` — список и карточка.  
Фактический старт нагрузки идёт через **GitLab CI** (Consul/Vault + webhook).
Без настроенного GitLab модуль остаётся каркасом. Детали: [`docs/module-3-run.md`](docs/module-3-run.md).

В форме запуска есть блок «Тестируемый сервис в кластере» (cluster / namespace / service /
container). Он не обязателен для старта, но без него модуль «Анализ» не сможет построить
запросы в VictoriaMetrics: из URL стенда не видно, какие поды за ним стоят.

### Анализ

`/analysis/new` — что анализировать: прогон портала, ссылка на дашборд Grafana или ручной
ввод цели и периода.
`/analysis/list`, `/analysis/{id}` — отчёты и карточка отчёта.

Отчёт даёт вердикт одной фразой, оценку 0–100, полосу фаз теста, гипотезы о причине с
пунктами «куда смотреть в коде», цепочки «причина → следствие» и находки с мини-графиками
и запросом MetricsQL для перепроверки. Детали: [`docs/module-4-analysis.md`](docs/module-4-analysis.md).

Источник метрик: Consul `victoriametrics/url`, `concurrency`, `timeout-sec`, секрет
Vault `loadtest/victoriametrics/bearer-token`. Пустой URL — синтетика; в форме есть
галочка «Показать на демо-данных». Принудительный демо-режим: Consul `analysis/demo`.

После завершения прогона отчёт заводится автоматически, если у прогона заполнена цель
(Consul `analysis/auto-on-finish`, иначе ConfigMap). Токен `X-Internal-Token` —
Vault `loadtest/internal-token`.

## Локальный запуск

```bash
docker compose up --build
```

| URL | Описание |
|---|---|
| http://localhost:3000 | Портал (API через `/api` proxy) |
| http://localhost:8080 | constructor |
| http://localhost:8082 | orchestrator |
| http://127.0.0.1:8081/ready | jmeter-builder (только localhost; `/generate` — `X-Internal-Token`) |
| http://127.0.0.1:8000/docs | analyzer (только localhost; `/analyze` — токен) |
| http://127.0.0.1:8001/docs | k6-generator |
| http://127.0.0.1:8002/docs | gatling-generator |
| http://127.0.0.1:8003/docs | analysis (`/analyze` — `X-Internal-Token`) |

Локальный конфиг: `config/consul-vault-config.local.yaml` (монтируется в constructor и orchestrator).  
Эталон для k8s ConfigMap: `config/consul-vault-config.yaml`.

Первый вход: логин `admin`, пароль — из `LOADTEST_BOOTSTRAP_ADMIN_PASSWORD` или
сгенерированный (смотри лог constructor: `Сгенерирован пароль bootstrap-админа`).
Обязательная смена пароля при первом входе. Уже существующий admin в БД не перезаписывается.

Опционально для прогонов локально:

```bash
export GITLAB_TRIGGER_TOKEN=...
export GITLAB_WEBHOOK_SECRET=...
docker compose up --build
```

## Frontend: same-origin `/api` + rewrites

`NEXT_PUBLIC_CORE_API_BASE_URL` вшивается в JS **на этапе `npm run build`**.  
Пустая строка (по умолчанию в compose/Dockerfile) = браузер ходит на `/api/...` того же host.

Next.js (`next.config.mjs`) на build-time прописывает destinations:

| Путь | Сервис |
|---|---|
| `/api/runs/*`, `/api/analysis*`, `/api/settings/gitlab*` | `ORCHESTRATOR_API_URL` (compose: `http://orchestrator:8082`) |
| остальные `/api/*` | `CONSTRUCTOR_API_URL` (compose: `http://constructor:8080`) |

В k8s/Ingress достаточно проксировать `/` на frontend; разделение constructor/orchestrator делает Next.  
Либо Ingress может слать webhook напрямую на orchestrator.

В `consul-vault-config.yaml`: `modules.frontend-api-base-url: ""`, `modules.orchestrator-url`.

## Bootstrap admin

При **первом** старте `constructor`, если пользователя `admin` ещё нет в БД:

| Параметр | Env | По умолчанию |
|---|---|---|
| Логин | `LOADTEST_BOOTSTRAP_ADMIN_USERNAME` | `admin` |
| Пароль | `LOADTEST_BOOTSTRAP_ADMIN_PASSWORD` | если пусто или `admin` — случайный, пишется в лог constructor |

Флаг **обязательной смены пароля** при первом входе.  
В проде пароль — из **Vault** (Secret → env), не из ConfigMap и не из git.  
Повторный старт **не** перезаписывает уже существующего admin.

## Liquibase + init-job БД

Схема БД — **Liquibase** (`constructor/src/main/resources/db/changelog/`).  
Hibernate: `ddl-auto: validate`.

**Argo Job (init DB)** — тот же образ `constructor`, без веб-сервера:

```bash
java -jar app.jar \
  --spring.main.web-application-type=none \
  --loadtest.db-init-exit=true
```

Job должен завершиться успешно до старта Deployment constructor (sync wave / PreSync hook).

## Probes (для манифестов)

| Компонент | liveness | readiness |
|---|---|---|
| frontend | `GET /` | `GET /` |
| constructor | `GET /health` | `GET /ready` (или `/ready/strict`) |
| orchestrator | `GET /health` | `GET /ready` |
| jmeter-builder | `GET /health` | `GET /ready` |
| analyzer | `GET /health` | `GET /ready` |
| k6-generator | `GET /health` | `GET /ready` |
| gatling-generator | `GET /health` | `GET /ready` |
| analysis | `GET /health` | `GET /ready` |
| postgres | `pg_isready` | `pg_isready` |

`/ready` у constructor возвращает 200 даже при деградации соседей (снимок зависимостей в теле).  
`/ready/strict` — 503, если сосед недоступен.

SSL/CA в модулях **не используются** (analyzer ходит за Swagger без verify).

## Обновление версий

Через **Argo CD** (image tag / Application sync). В репозитории нет Helm/overlays —
только исходники и `config/`.

## Структура репозитория

```
loadtest-portal/
├── frontend/          # Next.js UI + /api rewrites
├── constructor/       # Spring: auth, сценарий, история, Liquibase
├── orchestrator/      # Spring: runs, GitLab, webhook
├── jmeter-builder/    # Scenario → JMX
├── analyzer/          # OpenAPI/Postman → Scenario
├── k6-generator/      # Scenario → k6
├── gatling-generator/ # Scenario → Gatling (Maven-проект в zip)
├── analysis/          # Метрики прогона → аномалии и гипотезы (каталоги правил в YAML)
├── config/
│   ├── consul-vault-config.yaml        # эталон ConfigMap (k8s)
│   └── consul-vault-config.local.yaml  # docker compose
├── docs/
└── docker-compose.yml
```

## API

Публичные пути те же (`/api/...`). Backend: constructor или orchestrator (см. proxy выше).

Auth (constructor): Bearer на `/api/**`, кроме `POST /api/auth/login`.  
Webhook (orchestrator): `POST /api/runs/webhook/gitlab` без Bearer (`X-Gitlab-Token`).  
При `must_change_password` разрешены только смена пароля и logout.

### Auth

| Метод | Путь | Описание |
|---|---|---|
| POST | `/api/auth/login` | Вход → token, role, must_change_password |
| POST | `/api/auth/logout` | Инвалидация сессии |
| GET | `/api/auth/me` | Проверка живой сессии |
| POST | `/api/auth/change-password` | Смена своего пароля |

### Сценарий / сборка

| Метод | Путь | Описание |
|---|---|---|
| POST | `/api/analyze` | OpenAPI/Postman → Scenario (без сохранения) |
| POST | `/api/build` | Разовая сборка JMeter (файл, без истории) |
| POST | `/api/build/k6` | Разовая сборка k6 (файл, без истории) |
| POST | `/api/builds/save` | Сборка + запись → `build_id` + `script_id` |
| GET | `/api/builds` | История сборок (последние 30 на пользователя; TTL 30 дней) |
| GET | `/api/builds/{id}/scenario` | Восстановить Scenario из сборки |
| DELETE | `/api/builds/{id}` | Удалить сборку (+ связанный portal_build скрипт) |

### Скрипты

| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/scripts` | Список скриптов пользователя |
| POST | `/api/scripts/upload` | Upload `.jmx` / `.js` / `.ts` / `.zip` |
| GET | `/api/scripts/{id}/download` | Скачать сохранённый артефакт |

### Прогоны (orchestrator)

| Метод | Путь | Описание |
|---|---|---|
| POST | `/api/runs` | Положить скрипт в S3 + trigger pipeline + создать прогон |
| GET | `/api/runs` | Список прогонов |
| GET | `/api/runs/{id}` | Карточка прогона |
| POST | `/api/runs/{id}/cancel` | Отменить прогон и pipeline GitLab |
| POST | `/api/runs/webhook/gitlab` | Webhook GitLab (`X-Gitlab-Token`, без Bearer) |

### Анализ (orchestrator)

| Метод | Путь | Описание |
|---|---|---|
| POST | `/api/analysis` | Поставить анализ в очередь → запись в статусе `queued` |
| GET | `/api/analysis` | Список отчётов (`?run_id=` — по конкретному прогону) |
| GET | `/api/analysis/{id}` | Отчёт целиком |
| POST | `/api/analysis/{id}/rerun` | Пересчитать: то же окно и цель, новая запись |
| DELETE | `/api/analysis/{id}` | Удалить отчёт |
| POST | `/api/analysis/parse-link` | Разбор ссылки на дашборд Grafana → поля формы |
| GET | `/api/analysis/catalog` | Каталог метрик и паттернов гипотез |

### Пользователи и настройки (admin)

| Метод | Путь | Сервис | Описание |
|---|---|---|---|
| GET | `/api/users` | constructor | Список пользователей |
| POST | `/api/users` | constructor | Создать пользователя |
| PUT | `/api/users/{username}/password` | constructor | Сменить пароль пользователя |
| DELETE | `/api/users/{username}` | constructor | Удалить пользователя |
| GET/PUT | `/api/settings/ldap` | constructor | LDAP (в UI нет, источник — Consul/Vault) |
| GET/PUT | `/api/settings/gitlab` | orchestrator | GitLab CI + Grafana (в UI нет, источник — Consul/Vault) |
| GET | `/api/settings/gitlab/defaults` | orchestrator | REPOSITORY для формы запуска |
| POST | `/api/settings/gitlab/test` | orchestrator | Проверка соединения с GitLab |

### Служебные

| Метод | Путь | Описание |
|---|---|---|
| GET | `/health` | Liveness |
| GET | `/ready` | Readiness + снимок зависимостей |
| GET | `/ready/strict` | Readiness; 503 при деградации |
| GET | `/metrics` | Prometheus text (все backend-модули) |

Внутренние генераторы (не через browser):

| Сервис | Метод | Путь |
|---|---|---|
| analyzer | POST | `/analyze` |
| jmeter-builder | POST | `/generate/jmeter` |
| k6-generator | POST | `/generate/k6` |
| gatling-generator | POST | `/generate/gatling` |
| analysis | POST | `/analyze`, `/parse-link`; GET `/catalog` |

## Документация

| Документ | Содержание |
|---|---|
| [`docs/domain-model.md`](docs/domain-model.md) | Контракт Scenario (snake_case JSON) |
| [`docs/data-model-ids.md`](docs/data-model-ids.md) | `build_id` / `script_id` / `test_id` / `run_id` |
| [`docs/module-3-run.md`](docs/module-3-run.md) | Модуль «Запуск», GitLab, webhook |
| [`docs/module-4-analysis.md`](docs/module-4-analysis.md) | Модуль «Анализ»: фазы, детекторы, отчёт |
| [`docs/metrics.md`](docs/metrics.md) | Метрики модулей, внешний scrape |
