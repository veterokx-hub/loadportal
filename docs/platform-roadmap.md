# Дорожная карта платформы нагрузочного тестирования

Видение: **единый корпоративный портал НТ** от подготовки сценария до отчёта для заказчика и команды разработки.

## Пять модулей

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        LOAD TEST PLATFORM (k8s)                             │
├─────────────┬─────────────┬─────────────┬─────────────┬─────────────────────┤
│  1. Script  │  2. SUT &   │  3. Load    │  4. Results │  5. Report          │
│  Preparation│  Stubs      │  Execution  │  Analytics  │  Generation         │
│  ✅ сейчас   │  🔜         │  🔜         │  🔜         │  🔜                 │
└─────────────┴─────────────┴─────────────┴─────────────┴─────────────────────┘
         │              │              │              │              │
         ▼              ▼              ▼              ▼              ▼
    Scenario.json   Helm/Kustomize   k6/JMeter Job  Prometheus+    PDF/HTML
    .jmx / .js      WireMock/Toxiproxy  + workers    Grafana+AI     Confluence
```

---

## Модуль 1 — Подготовка скрипта (текущий фокус)

**Статус:** MVP в разработке, готов к деплою в k8s.

**Ценность:** снижает время подготовки сценария с дней до часов; единый контракт Scenario для JMeter и k6.

**K8s:** Helm chart `deploy/helm/loadtest-portal`.

**Следующие шаги продукта:**
- Экспорт Scenario в **Git** (GitOps-сценарии)
- Версионирование сценариев (не только история сборок)
- Шаблоны сценариев («e-commerce checkout», «OAuth login flow»)
- AI-подсказки корреляции (analyzer enrich)

---

## Модуль 2 — Развёртывание SUT и заглушек

**Статус:** следующий фокус. Детальный план и чеклист информации: [`module-2-plan.md`](module-2-plan.md).

**Цель:** поднять тестируемый сервис (или его версию) и зависимости-заглушки в изолированном namespace.

### Архитектурные идеи

| Подход | Инструмент | Когда |
|---|---|---|
| **Helm umbrella chart** | Зависимости SUT + WireMock | Стандартный микросервис в k8s |
| **Namespace per test run** | `loadtest-run-{id}` | Полная изоляция прогона |
| **WireMock / Mountebank** | Deployment + ConfigMap stubs | Внешние интеграции недоступны |
| **Toxiproxy** | Sidecar | Хаос: latency, timeout, partition |
| **Service Mesh (Istio)** | VirtualService, FaultInjection | Продвинутая симуляция деградации |
| **Ephemeral env** | Argo CD ApplicationSet | Ветка → временный стенд |

### Контракт с модулем 1

```yaml
# ScenarioRunSpec (будущий CRD)
scenarioRef: build-uuid-from-module-1
target:
  baseUrl: http://sut.loadtest-run-42.svc.cluster.local
stubs:
  - name: payment-gateway
    image: wiremock/wiremock
    mappings: configmap/payment-stubs
```

### Что заложить уже сейчас

- Поле `baseUrl` в Scenario — переопределяется при запуске (не хардкод prod URL)
- Dataset CSV → Secret/ConfigMap для pod'ов модуля 3

---

## Модуль 3 — Генератор нагрузки и запуск

**Цель:** выполнить `.jmx` или k6-скрипт с заданным профилем нагрузки.

### Архитектурные идеи

| Движок | K8s паттерн | Плюсы |
|---|---|---|
| **k6** | `Job` + `k6 run` | Легковесный, cloud-native, хорош для CI |
| **k6 distributed** | k6-operator | Высокий RPS, несколько runner pod'ов |
| **JMeter** | Helm jmeter + slave pods | Совместимость с legacy, Prometheus listener |
| **Locust** (опционально) | Job | Python-команды |

### Рекомендуемый стек для corp k8s

1. **k6-operator** для основной нагрузки
2. **JMeter** — для сценариев с тяжёлой корреляцией / GUI-наследием
3. **Argo Workflows** — оркестрация: deploy SUT → smoke → load → teardown

```yaml
# Пример pipeline (Argo)
- deploy-sut-template
- run-k6-template      # inputs: script from S3, env vars
- collect-metrics-template
- teardown-template
```

### Интеграция с модулем 1

- Артефакты сборки → **MinIO/S3** bucket `loadtest-artifacts/{user}/{buildId}/`
- API `POST /api/runs` (модуль 3) принимает `build_id` из истории пользователя

---

## Модуль 4 — Сбор и анализ результатов

**Цель:** собрать метрики, логи, SLA; дать рекомендации («узкое место — БД», «увеличить пул соединений»).

### Источники данных

| Источник | JMeter | k6 |
|---|---|---|
| RPS, latency | Prometheus (Kolesnikov listener) | k6 → Prometheus remote write |
| Errors | Listener / InfluxDB | k6 checks |
| Infra | kube-state-metrics, cAdvisor | same |
| APM | Datadog, Jaeger trace | optional |

### Аналитика и рекомендации

1. **Rule engine** — пороги SLA, сравнение с baseline прошлого прогона
2. **Grafana dashboards** — шаблон per run
3. **LLM-слой** (опционально) — «объясни, почему p99 вырос после деплоя X»
4. **Readiness score** из модуля 1 — связать с фактическим результатом («прогноз vs реальность»)

### K8s

- Prometheus Operator + ServiceMonitor (уже заложено в Helm values модуля 1)
- Loki для логов runner pod'ов
- Thanos/Mimir для long-term storage

---

## Модуль 5 — Формирование отчёта

**Цель:** PDF/HTML/Confluence-страница для заказчика, release notes, audit trail.

### Содержание отчёта

- Executive summary (1 страница)
- Конфигурация: сценарий, профиль, версия SUT
- Графики: RPS, latency percentiles, error rate
- Сравнение с предыдущим прогоном (delta)
- Рекомендации из модуля 4
- Приложение: raw JMX/k6, параметры корреляции

### Технологии

- **Gotenberg / WeasyPrint** — HTML → PDF в Job
- **Confluence API** — публикация в space QA
- **Allure** — если команда уже использует для функциональных тестов

---

## Единая модель данных (сквозная)

```
PortalUser ──► BuildRecord ──► TestRun ──► MetricsBundle ──► Report
                  │                │
                  └── Scenario JSON  └── k8s Job / Workflow ID
```

PostgreSQL модуля 1 → позже **события в Kafka** (`run.started`, `run.finished`) для loose coupling.

---

## Роли и RBAC (k8s + портал)

| Роль | Портал | K8s |
|---|---|---|
| НТ инженер | USER: сценарии, сборки | `loadtest-run` create Job |
| Lead НТ | ADMIN: пользователи, LDAP | approve prod-like runs |
| Dev | read-only отчёты | — |
| Platform | — | Helm, CRD, quotas |

---

## Маркeting / позиционирование (идеи)

**Название платформы:** «НТ · Портал» / «LoadTest Hub» / «PerfStudio Corp»

**Key messages:**
- *«От Swagger до отчёта — без ручного JMX»*
- *«Один сценарий — два движка (JMeter + k6)»*
- *«Корпоративный LDAP, изоляция прогонов, audit trail»*

**Quick wins для пилота (4–6 недель):**
1. Модуль 1 в k8s + 5 пилотных пользователей НТ
2. k6 Job вручную из собранного скрипта (мост к модулю 3)
3. Grafana dashboard для одного прогона
4. PDF-отчёт v0 (шаблон + скриншоты)

**Метрики успеха пилота:**
- Time-to-first-script: < 2 часа (vs 2 дня baseline)
- % сценариев без доработки JMX вручную: > 70%
- NPS команды НТ ≥ 8

**Roadmap narrative для руководства:**

| Квартал | Deliverable |
|---|---|
| Q1 | Модуль 1 prod + LDAP |
| Q2 | k6 runs из UI + базовые метрики |
| Q3 | SUT deploy + stubs + сравнение прогонов |
| Q4 | Автоотчёты + рекомендации |

---

## Технический долг / риски

| Риск | Митигация |
|---|---|
| Hibernate `ddl-auto: update` в prod | Flyway/Liquibase до go-live |
| Analyzer SSRF (URL Swagger) | Allowlist доменов, NetworkPolicy |
| Default admin password | Mandatory change / SSO |
| JMeter RPS в k8s | k6-operator для high load; JMeter — dedicated node pool |

---

## Что уточнить у заказчика (чеклист)

1. Есть ли **managed PostgreSQL** и **S3/MinIO**?
2. Какой **Ingress controller** (nginx, traefik, istio gateway)?
3. **GitOps** (Argo/Flux) или ручной Helm?
4. Основной движок нагрузки: **k6 или JMeter**?
5. Нужен ли **SSO (OIDC/SAML)** поверх LDAP?
6. Квоты namespace: CPU/RAM для load generators?
7. Отдельный **node pool** для НТ (taints/tolerations)?

Ответы определят приоритет модулей 2–3 и sizing кластера.
