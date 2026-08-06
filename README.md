# Load Test Portal (НТ · Портал)

Портал подготовки и запуска сценариев нагрузочного тестирования:
**OpenAPI / Postman / чистый лист → JMeter `.jmx` / k6 `.js` → (частично) прогон через GitLab CI**.

Окружение: **один прод-экземпляр** в тестовом k8s-кластере. Манифесты k8s / Argo — **вне репозитория**.
Здесь — исходники сервисов, `docker-compose.yml` для локальной разработки и эталон
`config/consul-vault-config.yaml` для ConfigMap.

## Статус модулей

| Модуль | UI | Состояние |
|---|---|---|
| **Сценарий** | `/scenario/*` | Готов: анализ, параметры, корреляция, сборка JMeter/k6, история |
| **Стенд** | `/environment` | Заглушка (roadmap) |
| **Запуск** | `/run/*` | **Частично**: карточки прогонов и триггер GitLab есть; полный цикл зависит от CI/секретов |
| **Анализ** | `/analysis` | Заглушка (roadmap) |
| **Отчёт** | `/report` | Заглушка (roadmap) |

Подробнее: [`docs/platform-roadmap.md`](docs/platform-roadmap.md), [`docs/module-3-run.md`](docs/module-3-run.md).

## Архитектура

| Сервис | Порт | Стек | Назначение |
|---|---:|---|---|
| `frontend` | 3000 | Next.js 14 / React 18 | UI портала |
| `constructor` | 8080 | Java 17 / Spring Boot 3.3 | Auth, orchestration, история, runs |
| `jmeter-builder` | 8081 | Java 17 / Spring Boot 3.3 | Scenario → `.jmx` |
| `analyzer` | 8000 | Python 3.12 / FastAPI | OpenAPI/Postman → Scenario |
| `k6-generator` | 8001 | Python 3.12 / FastAPI | Scenario → k6 |
| `postgres` | 5432 | PostgreSQL 16 | Пользователи, сборки, скрипты, прогоны |

Контейнер VictoriaMetrics **не поставляется** — метрики модулей (`GET /metrics`) скрейпит
ваша внешняя VictoriaMetrics / Prometheus. См. [`docs/metrics.md`](docs/metrics.md).

```
Browser ──► Ingress
              /      → frontend
              /api    → constructor
                          ├─► jmeter-builder
                          ├─► analyzer
                          ├─► k6-generator
                          └─► PostgreSQL
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
   - Движок: **JMeter** или **k6**
   - Сохранить сборку / выгрузить скрипт / перейти к запуску
   - История сборок (последние 20, в UI видны ~3 строки со скроллом)

Перед заменой сценария («Новый сценарий», подтягивание старой сборки) UI предлагает
сохранить текущую сборку. Сохранение доступно даже при замечаниях в «Пульсе сценария».

### Запуск (частично)

`/run/new` — создать прогон из сохранённой сборки или загруженного скрипта.  
`/run/list`, `/run/{id}` — список и карточка.  
Фактический старт нагрузки идёт через **GitLab CI** (настройки admin + webhook).
Без настроенного GitLab модуль остаётся каркасом. Детали: [`docs/module-3-run.md`](docs/module-3-run.md).

## Локальный запуск

```bash
docker compose up --build
```

| URL | Описание |
|---|---|
| http://localhost:3000 | Портал |
| http://localhost:8080 | constructor |
| http://localhost:8081/ready | jmeter-builder |
| http://localhost:8000/docs | analyzer (OpenAPI) |
| http://localhost:8001/docs | k6-generator (OpenAPI) |

Локальный конфиг: `config/consul-vault-config.local.yaml` (монтируется в constructor).  
Эталон для k8s ConfigMap: `config/consul-vault-config.yaml`.

Первый вход: `admin` / `admin` → обязательная смена пароля.

Опционально для прогонов локально:

```bash
export GITLAB_TRIGGER_TOKEN=...
export GITLAB_WEBHOOK_SECRET=...
docker compose up --build
```

## Критично: frontend + пустой API base (same-origin)

`NEXT_PUBLIC_CORE_API_BASE_URL` вшивается в JS **на этапе `npm run build`**, не в runtime.

| Сборка | Значение | Поведение браузера |
|---|---|---|
| Локально (compose) | `http://localhost:8080` | Прямой вызов constructor |
| **k8s / Ingress** | **пустая строка `""`** | Запросы на `/api/...` того же host |

Если собрать frontend с `localhost:8080` и выкатить в k8s — UI «жив», а API «молчит»
(браузер бьёт в localhost пользователя). Для Argo/prod: **пересобирать образ frontend
с пустым `NEXT_PUBLIC_CORE_API_BASE_URL`**.

В `consul-vault-config.yaml` поле `modules.frontend-api-base-url: ""` отражает тот же принцип.

## Bootstrap admin

При **первом** старте `constructor`, если пользователя `admin` ещё нет в БД:

| Параметр | Env | По умолчанию |
|---|---|---|
| Логин | `LOADTEST_BOOTSTRAP_ADMIN_USERNAME` | `admin` |
| Пароль | `LOADTEST_BOOTSTRAP_ADMIN_PASSWORD` | `admin` |

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
| jmeter-builder | `GET /health` | `GET /ready` |
| analyzer | `GET /health` | `GET /ready` |
| k6-generator | `GET /health` | `GET /ready` |
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
├── frontend/          # Next.js UI
├── constructor/       # Spring: auth, orchestration, Liquibase
├── jmeter-builder/    # Scenario → JMX
├── analyzer/          # OpenAPI/Postman → Scenario
├── k6-generator/      # Scenario → k6
├── config/
│   ├── consul-vault-config.yaml        # эталон ConfigMap (k8s)
│   └── consul-vault-config.local.yaml  # docker compose
├── docs/
└── docker-compose.yml
```

## API (constructor)

Auth: Bearer на `/api/**`, кроме `POST /api/auth/login` и `POST /api/runs/webhook/gitlab`.  
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
| GET | `/api/builds` | История сборок (последние 20 на пользователя) |
| GET | `/api/builds/{id}/scenario` | Восстановить Scenario из сборки |

### Скрипты

| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/scripts` | Список скриптов пользователя |
| POST | `/api/scripts/upload` | Upload `.jmx` / `.js` |
| GET | `/api/scripts/{id}/download` | Скачать сохранённый артефакт |

### Прогоны

| Метод | Путь | Описание |
|---|---|---|
| POST | `/api/runs` | Создать прогон |
| GET | `/api/runs` | Список прогонов |
| GET | `/api/runs/{id}` | Карточка прогона |
| POST | `/api/runs/webhook/gitlab` | Webhook GitLab (`X-Gitlab-Token`, без Bearer) |

### Пользователи и настройки (admin)

| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/users` | Список пользователей |
| POST | `/api/users` | Создать пользователя |
| PUT | `/api/users/{username}/password` | Сменить пароль пользователя |
| DELETE | `/api/users/{username}` | Удалить пользователя |
| GET/PUT | `/api/settings/ldap` | LDAP |
| GET/PUT | `/api/settings/gitlab` | GitLab CI + Grafana |
| POST | `/api/settings/gitlab/test` | Проверка соединения с GitLab |

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

## Документация

| Документ | Содержание |
|---|---|
| [`docs/domain-model.md`](docs/domain-model.md) | Контракт Scenario (snake_case JSON) |
| [`docs/data-model-ids.md`](docs/data-model-ids.md) | `build_id` / `script_id` / `test_id` / `run_id` |
| [`docs/module-3-run.md`](docs/module-3-run.md) | Модуль «Запуск», GitLab, webhook |
| [`docs/metrics.md`](docs/metrics.md) | Метрики модулей, внешний scrape |
| [`docs/architecture-overview.md`](docs/architecture-overview.md) | Обзор архитектуры |
| [`docs/class-diagrams.md`](docs/class-diagrams.md) | Схемы классов модулей |
| [`docs/module-2-plan.md`](docs/module-2-plan.md) | План модуля «Стенд» |
| [`docs/platform-roadmap.md`](docs/platform-roadmap.md) | Дорожная карта платформы |
