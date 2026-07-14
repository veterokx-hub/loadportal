# План подготовки платформы и модуль 2 (SUT + stubs)

Документ сводит всё, что обсуждалось по порталу НТ, фиксирует **текущее состояние модуля 1**, **план перехода к модулям 2–5** и **чеклист информации**, без которой нельзя спроектировать развёртывание тестируемых сервисов и заглушек.

Связанные материалы:
- [`architecture-overview.md`](architecture-overview.md) — целевая архитектура
- [`platform-roadmap.md`](platform-roadmap.md) — пять модулей
- [`deploy/k8s.md`](deploy/k8s.md) — деплой модуля 1
- [`domain-model.md`](domain-model.md) — контракт `Scenario`

---

## 1. Что уже есть (модуль 1 — «Подготовка скрипта»)

| Компонент | Статус | Назначение |
|---|---|---|
| `frontend` | ✅ | Мастер: источник → запросы → корреляция → интенсивность/сборка |
| `constructor` | ✅ | Auth (local + LDAP AD), users, сборка JMX/k6, история сборок |
| `analyzer` | ✅ | OpenAPI / Postman → `Scenario` |
| `k6-generator` | ✅ | `Scenario` → k6 `.js` (отдельный сервис) |
| PostgreSQL | ✅ | users, sessions, LDAP settings, build history (20 на пользователя) |
| Helm chart | ✅ | `deploy/helm/loadtest-portal` |
| Auth | ✅ | Bearer-сессии; admin — принудительная смена пароля; LDAP bind+search без групп |
| UI параметров | ✅ | Вкладки Header/Query/Body/Path; Path только из URL шага 2 |

**Сквозной контракт:** `Scenario` JSON — источник истины; `.jmx` / `.js` — производные артефакты.

**Пока нет (нужно для модулей 2–5):**
- выгрузка артефактов в S3/MinIO
- событие `build.completed` (Kafka / webhook)
- CRD `TestRun` / `Environment`
- namespace per run, WireMock/Toxiproxy orchestration
- k6-operator / JMeter runners
- baseline comparison, отчёты

---

## 2. Целевая платформа (5 модулей)

```
1. Script Preparation  ✅  →  Scenario + .jmx/.js
2. SUT & Stubs         🔜  →  стенд + заглушки (фокус следующего шага)
3. Load Execution      🔜  →  k6-operator / JMeter в k8s
4. Results Analytics   🔜  →  Prometheus + Loki + baseline
5. Report              🔜  →  PDF / Confluence
```

**Оркестрация (целевая):** Argo Workflows  
`deploy SUT+stubs → smoke → load → collect → analyze → report → teardown`

**Изоляция:** `namespace` на прогон (`loadtest-run-{id}`).  
**Артефакты:** S3/MinIO, не LOB в PostgreSQL.  
**Связь модулей:** `build.completed` → Kafka (или HTTP webhook на старте).

---

## 3. План подготовки портала к остальным модулям

### Фаза A — контракты и стыки (до/параллельно с модулем 2)

| # | Задача | Зачем | Результат |
|---|---|---|---|
| A1 | Зафиксировать `EnvironmentSpec` + `StubSpec` (YAML/JSON) | Единый вход модуля 2 | Черновик API + пример в `docs/` |
| A2 | Поле/override `baseUrl` для прогона | Runner бьёт в стенд, не в prod | В Scenario / TestRun |
| A3 | Решить хранилище артефактов (S3/MinIO) | Модули 2–3 читают script/scenario | Bucket + IAM/Secret |
| A4 | Канал событий: Kafka **или** webhook MVP | Loose coupling 1→2→3 | Выбор + POC |
| A5 | Модель `TestEnvironment` / `TestRun` в БД или CRD | UI + API статуса стенда | Схема сущностей |

### Фаза B — модуль 2 MVP (SUT + stubs)

| # | Задача | Результат |
|---|---|---|
| B1 | Выбор стратегии деплоя SUT (см. §4) | Утверждённый вариант A/B/C |
| B2 | Namespace lifecycle: create → ready → destroy | API + Job/operator |
| B3 | Каталог заглушек WireMock (+ опционально Toxiproxy) | Deploy + ConfigMap mappings |
| B4 | Health/ready стенда → `baseUrl` в портал | Status: Pending / Ready / Failed |
| B5 | UI: «Стенд» — выбрать env template, stubs, задеплоить | Экран после сборки сценария |
| B6 | RBAC + квоты + NetworkPolicy на run-namespace | Согласование с platform |

### Фаза C — мост к модулю 3

| # | Задача | Результат |
|---|---|---|
| C1 | POC: k6 Job против `baseUrl` стенда | Один успешный прогон |
| C2 | Передача `scenarioRef` / `buildId` + script из S3 | Контракт runner |
| C3 | Node pool / taints для generators | Не мешать prod |

### Фаза D — анализ и отчёт (позже)

Baseline N−1, readiness score vs факт, PDF/Confluence — по [`platform-roadmap.md`](platform-roadmap.md).

---

## 4. Модуль 2 — варианты реализации

| Вариант | Суть | Плюсы | Минусы | Когда выбирать |
|---|---|---|---|---|
| **A. Helm umbrella** | Chart: SUT + deps + WireMock | Привычно DevOps | Нужен готовый chart SUT | Сервис уже в Helm |
| **B. Manifest pack / Kustomize** | Готовый набор YAML на сервис | Простой контроль | Ручная поддержка | 1–3 пилотных SUT |
| **C. Argo CD Application** | GitOps: ApplicationSet на run-ns | Audit, rollback | Сложнее MVP | Corp уже на Argo CD |
| **D. External URL only** | Стенд снаружи, портал только `baseUrl` | Быстрый старт | Нет изоляции/stubs в k8s | Пилот без деплоя SUT |

**Рекомендация для старта:**  
**D (external URL)** как fallback + **B или A** для 1 пилотного сервиса с WireMock в `loadtest-run-*`.  
Toxiproxy / Istio FaultInjection — после стабильного MVP.

### Целевой контракт модуля 2 (черновик)

```yaml
apiVersion: loadtest.corp/v1
kind: TestEnvironment
metadata:
  name: env-checkout-42
  namespace: loadtest-run-42
spec:
  # Откуда поднять SUT
  sut:
    type: helm          # helm | kustomize | image | external
    chart: oci://registry.corp/charts/checkout-service
    version: "1.4.2"
    values:
      replicaCount: 2
      image.tag: "build-abc"
    # или:
    # externalBaseUrl: https://checkout-stage.corp.example

  stubs:
    - name: payment-gateway
      type: wiremock
      port: 8080
      mappingsRef: configmap/payment-stubs-v3
    - name: scoring
      type: wiremock
      mappingsRef: configmap/scoring-stubs

  chaos:                 # опционально, фаза 2
    - target: payment-gateway
      toxiproxy:
        latencyMs: 200
        timeoutMs: 0

  resources:
    cpuLimit: "4"
    memoryLimit: 8Gi
  ttlHours: 4            # авто-teardown
status:
  phase: Ready           # Pending | Ready | Failed | Destroying
  baseUrl: http://checkout.loadtest-run-42.svc.cluster.local
  stubUrls:
    payment-gateway: http://payment-gateway.loadtest-run-42.svc:8080
```

Связь с модулем 1:

```
BuildRecord (buildId)
  → Scenario JSON + artifacts
  → TestEnvironment (namespace, baseUrl)
  → TestRun (engine=k6|jmeter, scenarioRef, target.baseUrl)
```

---

## 5. Что заложить в модуле 1 уже сейчас (короткий backlog)

Чтобы модуль 2 не упирался в переделки:

1. **Стабильный `buildId` + API** `GET /api/builds/{id}/scenario` (уже есть) — оставить публичным контрактом для env/runner.
2. **Override `baseUrl`** на уровне прогона (не зашивать prod в Scenario).
3. **Артефакты в object storage** (после выбора S3/MinIO) — путь `artifacts/{user}/{buildId}/scenario.json|*.jmx|*.js`.
4. **Событие или webhook** `build.completed` (даже HTTP POST в MVP).
5. **Allowlist доменов** для analyzer (SSRF) — пригодится и для health-check SUT URL.
6. Не раздувать PostgreSQL большими JSON/скриптами — метаданные в БД, файлы в S3.

---

## 6. Список необходимой информации

Без ответов на блоки ниже дизайн модуля 2 будет гаданием. Отметьте «есть / нет / позже».

### 6.1 Инфраструктура k8s (platform)

| # | Вопрос | Зачем |
|---|---|---|
| 1 | Есть ли отдельный namespace/проект для НТ (`loadtest`)? | Изоляция портала |
| 2 | Можно ли **динамически создавать namespaces** `loadtest-run-*` (RBAC ServiceAccount)? | Namespace per run |
| 3 | ResourceQuota / LimitRange на run-ns? Лимиты CPU/RAM/pods? | Защита кластера |
| 4 | NetworkPolicy / egress: куда SUT может ходить (только stubs / внешний мир)? | Безопасность |
| 5 | Ingress для временных стендов нужен или только ClusterIP внутри кластера? | Доступ снаружи / только generator |
| 6 | Есть ли **Argo CD / Flux / Argo Workflows**? | Выбор варианта деплоя |
| 7 | Container registry для образов SUT и stub'ов + pull secrets | Деплой |
| 8 | StorageClass / PVC для SUT (БД тестового стенда)? | Stateful SUT |
| 9 | Managed PostgreSQL / Redis для SUT или всё ephemeral? | Состав стенда |
| 10 | Выделенный **node pool** (taints) для нагрузки / стендов? | Не мешать prod |
| 11 | Prometheus / Grafana уже в кластере? Namespace для метрик прогона? | Модули 3–4 |
| 12 | S3 или MinIO в corp? Bucket + credentials? | Артефакты |
| 13 | Kafka / MQ есть? Или достаточно webhook? | События |
| 14 | Vault / External Secrets? | Секреты стенда |

### 6.2 Тестируемые сервисы (команды продуктов)

| # | Вопрос | Зачем |
|---|---|---|
| 15 | **Какие 1–3 сервиса** в пилоте модуля 2? | Фокус MVP |
| 16 | Как сейчас деплоят SUT: Helm / Kustomize / манифесты / только VM? | Вариант A/B/C |
| 17 | Есть ли **готовый Helm chart** и values для stage-like конфигурации? | Umbrella |
| 18 | Образ SUT: тег = git sha / build number? Откуда брать? | Версия под тест |
| 19 | Зависимости SUT: БД, очередь, кэш — что **обязательно real**, что **stub**? | Состав env |
| 20 | Список внешних интеграций для WireMock (URL, OpenAPI, примеры ответов)? | Mappings |
| 21 | Нужен ли хаос (latency/timeout) на stubs сразу или позже? | Toxiproxy |
| 22 | Health/ready endpoints SUT? | phase=Ready |
| 23 | Типичный размер стенда (CPU/RAM) и длительность жизни (часы)? | TTL / квоты |
| 24 | Секреты стенда: как передавать (Vault path, K8s Secret, UI)? | Security |

### 6.3 Процесс НТ и продукт

| # | Вопрос | Зачем |
|---|---|---|
| 25 | Кто создаёт стенд: только НТ / ещё разработчик? | RBAC портала |
| 26 | Стенд **на каждый прогон** или **общий shared stage** + stubs? | Lifecycle |
| 27 | Нужен ли UI «каталог шаблонов стендов» или YAML в Git? | UX модуля 2 |
| 28 | Основной движок нагрузки дальше: **k6** или **JMeter**? | Модуль 3 |
| 29 | LDAP уже ок; нужен ли SSO (OIDC) позже? | Auth roadmap |
| 30 | SLA пилота модуля 2: дата, критерии успеха | Scope freeze |

### 6.4 Минимальный набор, чтобы начать проектирование на этой неделе

Если ответить только на это — можно стартовать дизайн MVP:

1. Пилотный сервис (один) + как его деплоят сейчас  
2. Можно ли создавать namespaces из ServiceAccount  
3. Список 2–5 внешних систем под WireMock  
4. S3/MinIO есть или нет  
5. Стенд ephemeral (на прогон) или long-lived  
6. k6 или JMeter как основной runner  

---

## 7. Критерии готовности модуля 2 (MVP)

- [ ] Из портала (или API) создаётся изолированный стенд с `baseUrl`
- [ ] Подняты согласованные WireMock-заглушки с mappings
- [ ] Статус Ready/Failed виден пользователю
- [ ] TTL / ручной teardown освобождает ресурсы
- [ ] Хотя бы один сценарий из модуля 1 может быть нацелен на `baseUrl` стенда (вручную или POC Job)
- [ ] Документированы квоты, RBAC и runbook для platform

---

## 8. Предлагаемый порядок работ (после ответов на §6)

```
Неделя 1   Уточнения §6.4 → выбор варианта деплоя (A/B/C/D)
Неделя 1–2 Контракт TestEnvironment + API skeleton в core-api
Неделя 2–3 Deploy controller/Job: ns + WireMock + (optional) SUT Helm
Неделя 3   UI «Стенд» + status polling
Неделя 4   POC: k6 Job → baseUrl; teardown; demo пилоту
```

---

## 9. Резюме

**Модуль 1 готов** как фабрика сценариев и артефактов.  
**Следующий шаг — модуль 2:** поднять SUT и/или заглушки, отдать стабильный `baseUrl` для нагрузки.  
**Блокер:** ответы на вопросы §6 (минимум §6.4).  
**Параллельно:** не раздувать модуль 1 фичами отчётов — заложить только стыки (baseUrl, artifacts, событие сборки).

После заполнения чеклиста можно переходить к детальному дизайну API/CRD и каркасу кода модуля 2 в репозитории.
