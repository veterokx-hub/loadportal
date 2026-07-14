# Load Test Portal (НТ · Портал)

Портал для подготовки сценариев нагрузочного тестирования. На входе — Swagger/OpenAPI или Postman-коллекция; на выходе — готовый **JMeter `.jmx`** или **k6 `.js`** с параметрами, корреляцией и профилем нагрузки.

## Архитектура

| Сервис | Порт | Технология | Назначение |
|---|---:|---|---|
| `frontend` | 3000 | Next.js + TypeScript | Мастер, история, настройки |
| `constructor` | 8080 | Java Spring Boot | Auth, пользователи, LDAP, orchestration, история |
| `jmeter-builder` | 8081 | Java Spring Boot | `Scenario` → JMeter `.jmx` / zip |
| `analyzer` | 8000 | Python FastAPI | OpenAPI/Postman → `Scenario` |
| `k6-generator` | 8001 | Python FastAPI | `Scenario` → k6-скрипт |
| `postgres` | 5432 | PostgreSQL 16 | Users, sessions, settings, builds |

```
                    ┌─────────────┐
  Swagger/Postman ─►│  analyzer   │──┐
                    └─────────────┘  │
                                       ▼
┌──────────┐                ┌──────────────┐     ┌──────────────┐
│ frontend │◄──────────────►│ constructor  │────►│ k6-generator │
└──────────┘   Bearer        └──────┬───────┘     └──────────────┘
                                    │
                                    ├──────────► jmeter-builder
                                    ▼
                               PostgreSQL
```

URL модулей по умолчанию — localhost/env. В **Настройки → Инфраструктура** можно включить **Consul** (KV/Catalog) или задать явные override.

Общий контракт данных: [`docs/domain-model.md`](docs/domain-model.md).

### Поток работы

1. **Источник** — загрузка OpenAPI URL или Postman JSON → `analyzer` → черновик сценария.
2. **Запросы** — правка методов, URL, тел, группировка.
3. **Корреляция и параметры** — заголовки, query, body, extractors.
4. **Интенсивность и сборка** — профиль RPS, AutoStop, Prometheus (JMeter), сборка `.jmx` или k6.

Каждая успешная сборка сохраняется в **истории пользователя** (привязка к учётной записи).

## Запуск

```bash
docker compose up --build
```

| URL | Описание |
|---|---|
| http://localhost:3000 | Портал |
| http://localhost:8080 | constructor |
| http://localhost:8081/health | jmeter-builder |
| http://localhost:8000/docs | Swagger analyzer |
| http://localhost:8001/docs | Swagger k6-generator |

### Учётные данные по умолчанию

При первом старте `constructor` создаёт администратора:

- **Логин:** `admin`
- **Пароль:** `admin` (при первом входе **обязательная смена пароля**)

Смените пароль или создайте отдельных пользователей в **Настройки → Пользователи** (доступно только администратору).

## Аутентификация

- Вход через `POST /api/auth/login` → Bearer-токен (сессия 24 ч).
- Все API-запросы (кроме login) требуют заголовок `Authorization: Bearer <token>`.
- История сборок изолирована по пользователю: каждый видит только **последние 20** своих сборок.

### LDAP / Active Directory

В **Настройки → LDAP / AD** (admin) задаются параметры корпоративного каталога.

**Вход по доменной учётке AD** (логин = sAMAccountName, пароль AD). Синхронизация групп AD **не используется** — роли ADMIN/USER задаются в портале. При первом входе через LDAP пользователь создаётся автоматически с ролью USER.

| Поле | Назначение |
|---|---|
| Включить LDAP | Попытка входа через AD при неудаче локального пароля |
| URL | `ldap://dc.corp.local:389` или `ldaps://...` |
| Base DN | Корень поиска, напр. `dc=corp,dc=local` |
| User DN pattern | Шаблон bind, напр. `uid={0},ou=people,...` |
| User search base | База для search-режима |
| User search filter | Фильтр, напр. `(sAMAccountName={0})` |
| Bind DN / password | Сервисная учётка для search (если нужна) |

Пользователи с флагом **«только LDAP»** не могут войти локальным паролем.

## Структура репозитория

```
loadtest-portal/
├── frontend/          # UI мастера
├── constructor/       # Java: auth, orchestration, persistence
├── jmeter-builder/    # Java: генерация JMX
├── analyzer/          # Python: OpenAPI + Postman parsers
├── k6-generator/      # Python: генерация k6-скриптов
├── deploy/            # Helm + DevOps handoff
├── docs/              # Документация
└── docker-compose.yml
```

## API (основное)

| Метод | Путь | Описание |
|---|---|---|
| POST | `/api/auth/login` | Вход |
| POST | `/api/auth/logout` | Выход |
| POST | `/api/analyze` | Анализ источника |
| POST | `/api/build` | Сборка JMeter `.jmx` |
| POST | `/api/build/k6` | Сборка k6 |
| GET | `/api/builds` | История сборок текущего пользователя (последние **20**) |
| GET | `/api/builds/{id}/scenario` | Восстановить сценарий из истории |
| GET/POST/DELETE | `/api/users` | Управление пользователями (admin) |
| GET/PUT | `/api/settings/ldap` | Настройки LDAP (admin) |

## JMeter: интенсивность и плагины

- **`constant_throughput`** — стандартный JMeter 5.6.3, без плагинов.
- **`shaping`** (точный RPS с рампой) — плагин **jpgc-casutg** (Custom Thread Groups + Throughput Shaping Timer).  
  Установка: JMeter → Plugins Manager → «Custom Thread Groups».

### Prometheus (только JMeter)

В каждый `.jmx` по умолчанию добавляется Backend Listener `com.github.kolesnikovm.PrometheusListener`.  
Порт exporter задаётся в шаге 4 (по умолчанию `9001`). Хост — на стороне запуска JMeter.

k6 использует встроенные `thresholds`, `check()` и `ramping-arrival-rate`; отдельный Prometheus listener не генерируется.

## Разработка локально

```bash
docker compose up --build
```

Переменные окружения analyzer: `ANALYZER_VERIFY_SSL`, `ANALYZER_CA_BUNDLE` (см. `docker-compose.yml`).

## Развёртывание в Kubernetes

Helm-чарт и документация для корпоративного k8s:

| Ресурс | Путь |
|---|---|
| Helm chart | [`deploy/helm/loadtest-portal/`](deploy/helm/loadtest-portal/) |
| Инструкция DevOps | [`docs/deploy/k8s.md`](docs/deploy/k8s.md) |
| Дорожная карта платформы (модули 1–5) | [`docs/platform-roadmap.md`](docs/platform-roadmap.md) |
| Архитектура целевой платформы | [`docs/architecture-overview.md`](docs/architecture-overview.md) |
| План модуля 2 (SUT + stubs) + чеклист вопросов | [`docs/module-2-plan.md`](docs/module-2-plan.md) |
| Сборка образов для registry | [`deploy/ci/build-and-push.sh`](deploy/ci/build-and-push.sh) |
| Handoff для DevOps (corp k8s) | [`deploy/HANDOFF-DEVOPS.md`](deploy/HANDOFF-DEVOPS.md) |

```bash
# production: same-origin API через Ingress
REGISTRY=registry.corp.example/loadtest TAG=0.1.0 \
NEXT_PUBLIC_CORE_API_BASE_URL="" \
./deploy/ci/build-and-push.sh

helm upgrade --install loadtest-portal ./deploy/helm/loadtest-portal \
  -f deploy/helm/loadtest-portal/values-production.example.yaml \
  -n loadtest --create-namespace
```

## Статус

Рабочий MVP: JMeter и k6, per-user история сборок, локальные пользователи + подготовка LDAP AD.
