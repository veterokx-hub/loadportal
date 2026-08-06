# Load Test Portal (НТ · Портал)

Портал для подготовки сценариев НТ: Swagger/OpenAPI или Postman → **JMeter `.jmx`** / **k6 `.js`**.

Окружение: **один прод-экземпляр** в тестовом k8s-кластере. Манифесты k8s / Argo — **вне репозитория** (формируете самостоятельно). Здесь — исходники сервисов + эталон `config/consul-vault-config.yaml`.

## Архитектура

| Сервис | Порт | Probes | Назначение |
|---|---:|---|---|
| `frontend` | 3000 | `/` | UI |
| `constructor` | 8080 | `/health`, `/ready` | Auth, LDAP, orchestration, история |
| `jmeter-builder` | 8081 | `/health`, `/ready` | Scenario → JMX |
| `analyzer` | 8000 | `/health`, `/ready` | OpenAPI/Postman → Scenario |
| `k6-generator` | 8001 | `/health`, `/ready` | Scenario → k6 |
| `postgres` | 5432 | `pg_isready` | Данные |

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
Секреты (БД, bootstrap-admin, LDAP bind) — **только Vault**.

## Критично: frontend + пустой API base (same-origin)

`NEXT_PUBLIC_CORE_API_BASE_URL` вшивается в JS **на этапе `npm run build`**, не в runtime.

| Сборка | Значение | Поведение браузера |
|---|---|---|
| Локально (compose) | `http://localhost:8080` | Прямой вызов constructor |
| **k8s / Ingress** | **пустая строка `""`** | Запросы на `/api/...` того же host (Ingress проксирует на constructor) |

Если собрать frontend с `localhost:8080` и выкатить в k8s — UI «жив», а API «молчит» (браузер бьёт в localhost пользователя).  
Поэтому для Argo/prod: **пересобирать образ frontend с пустым `NEXT_PUBLIC_CORE_API_BASE_URL`**.

В `consul-vault-config.yaml` поле `modules.frontend-api-base-url: ""` отражает тот же принцип (same-origin).

## Bootstrap admin

При **первом** старте `constructor`, если пользователя `admin` ещё нет в БД, создаётся учётка:

- логин из `LOADTEST_BOOTSTRAP_ADMIN_USERNAME` (по умолчанию `admin`)
- пароль из `LOADTEST_BOOTSTRAP_ADMIN_PASSWORD` (по умолчанию `admin`)
- флаг **обязательной смены пароля** при первом входе

Пароль в проде берётся из **Vault** (Secret → env), не из ConfigMap и не из git.  
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

Job должен завершиться успешно до старта Deployment constructor (sync wave / PreSync hook в Argo).

## Probes (для ваших манифестов)

| Компонент | liveness | readiness |
|---|---|---|
| frontend | `GET /` | `GET /` |
| constructor | `GET /health` | `GET /ready` (или `/ready/strict`) |
| jmeter-builder | `GET /health` | `GET /ready` |
| analyzer | `GET /health` | `GET /ready` |
| k6-generator | `GET /health` | `GET /ready` |
| postgres | `pg_isready` | `pg_isready` |

SSL/CA в модулях **не используются** (analyzer ходит за Swagger без verify).

## Обновление версий

Через **Argo CD** (image tag / Application sync). В репозитории нет Helm/overlays — только исходники и `config/`.

## Локальный запуск

```bash
docker compose up --build
```

| URL | Описание |
|---|---|
| http://localhost:3000 | Портал |
| http://localhost:8080 | constructor |
| http://localhost:8081/ready | jmeter-builder |
| http://localhost:8000/docs | analyzer |
| http://localhost:8001/docs | k6-generator |

Локальный конфиг: `config/consul-vault-config.local.yaml` (монтируется в constructor).  
Эталон для k8s ConfigMap: `config/consul-vault-config.yaml`.

Первый вход: `admin` / `admin` → смена пароля.

## Структура репозитория

```
loadtest-portal/
├── frontend/
├── constructor/       # Liquibase changelog, discovery config
├── jmeter-builder/
├── analyzer/
├── k6-generator/
├── config/
│   ├── consul-vault-config.yaml        # эталон ConfigMap (k8s)
│   └── consul-vault-config.local.yaml  # docker compose
├── docs/
└── docker-compose.yml
```

## API (основное)

| Метод | Путь | Описание |
|---|---|---|
| POST | `/api/auth/login` | Вход |
| POST | `/api/analyze` | Анализ источника |
| POST | `/api/build` | Разовая сборка JMeter (файл, без записи в историю) |
| POST | `/api/build/k6` | Разовая сборка k6 (файл, без записи в историю) |
| POST | `/api/builds/save` | Сборка + сохранение → `build_id` + `script_id` |
| GET | `/api/builds` | История (последние 20) |
| GET/POST | `/api/scripts` | Скрипты пользователя / upload |
| GET | `/api/scripts/{id}/download` | Скачать сохранённый артефакт |
| GET/PUT | `/api/settings/ldap` | LDAP (admin) |
| GET/PUT | `/api/settings/gitlab` | GitLab CI + Grafana (admin) |
| POST | `/api/settings/gitlab/test` | Проверка GitLab |
| POST/GET | `/api/runs` | Прогоны нагрузки |
| GET | `/api/runs/{id}` | Карточка прогона |
| POST | `/api/runs/webhook/gitlab` | Webhook GitLab (без Bearer) |
| GET | `/metrics` | Метрики модуля (Prometheus / VictoriaMetrics) |

Модуль «Запуск»: [`docs/module-3-run.md`](docs/module-3-run.md).  
Идентификаторы (`build_id` / `script_id` / `test_id` / `run_id`): [`docs/data-model-ids.md`](docs/data-model-ids.md).  
Метрики: [`docs/metrics.md`](docs/metrics.md) — сбор выполняет внешняя VictoriaMetrics.

Общий контракт: [`docs/domain-model.md`](docs/domain-model.md).  
Схемы классов модулей: [`docs/class-diagrams.md`](docs/class-diagrams.md).
