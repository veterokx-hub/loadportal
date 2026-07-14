# Архитектура платформы НТ

Краткая схема: **что есть сейчас (модуль 1)** и **куда развивается платформа** по идеям архитектора, НТ-инженера и DevOps.

---

## 1. Общая карта платформы

```mermaid
flowchart TB
  subgraph M1["Модуль 1 · Подготовка скрипта ✅"]
    UI[frontend]
    API[core-api]
    AN[analyzer]
    K6G[k6-generator]
    PG[(PostgreSQL)]
    UI --> API
    API --> AN
    API --> K6G
    API --> PG
  end

  subgraph ART["Артефактное хранилище"]
    S3[(S3 / MinIO)]
  end

  subgraph BUS["Шина событий"]
    KF{{Kafka<br/>build.completed}}
  end

  subgraph M2["Модуль 2 · SUT + stubs"]
    SUT[Тестируемый сервис]
    WM[WireMock]
    TX[Toxiproxy]
  end

  subgraph M3["Модуль 3 · Нагрузка"]
    TR[TestRun CRD]
    K6O[k6-operator]
    JM[JMeter cluster]
  end

  subgraph M4["Модуль 4 · Анализ"]
    PROM[Prometheus]
    LOKI[Loki]
    BL[Baseline store]
    AI[Recommendations]
  end

  subgraph M5["Модуль 5 · Отчёт"]
    RPT[PDF / Confluence]
  end

  subgraph ORCH["Оркестрация"]
    AW[Argo Workflows]
  end

  API -->|Scenario.json + .jmx/.js| S3
  API -->|build.completed| KF
  KF --> AW
  AW --> M2
  AW --> TR
  TR --> K6O
  TR --> JM
  K6O --> PROM
  JM --> PROM
  K6O --> LOKI
  PROM --> AI
  AI --> BL
  AI --> RPT
  S3 --> TR
  SUT --- WM
  SUT --- TX
```

---

## 2. Сквозной контракт данных

**`Scenario` — единственный источник истины.** JMX и k6.js — производные артефакты.

```mermaid
flowchart LR
  SRC[OpenAPI / Postman] --> AN[analyzer]
  AN --> SC[Scenario JSON]
  SC --> UI[Редактор UI]
  UI --> SC
  SC --> API[core-api]
  API --> JMX[.jmx]
  API --> JS[.js k6]
  SC --> S3[(S3)]
  JMX --> S3
  JS --> S3
  S3 -->|scenarioRef| RUN[TestRun]
```

| Слой | Формат | Где живёт |
|---|---|---|
| Домен | `Scenario` JSON | UI state, PostgreSQL (история 20), **S3** (канон) |
| JMeter | `.jmx` | S3, скачивается runner'ом |
| k6 | `.js` | S3, монтируется в k6-operator Job |
| Метаданные сборки | id, user, engine, timestamp | PostgreSQL + событие Kafka |

PostgreSQL — **метаданные и история**, не бинарники и не большие JSON навсегда.

---

## 3. Модуль 1 — as-is (то, что уже есть)

```mermaid
flowchart TB
  USER[Пользователь AD / local] --> ING[Ingress]
  ING -->|/| FE[frontend :3000]
  ING -->|/api| API[constructor :8080]

  API --> PG[(PostgreSQL<br/>users · builds · LDAP)]
  API --> AN[analyzer :8000]
  API --> KG[k6-generator :8001]

  AN -->|OpenAPI URL| EXT[Corp Swagger ⚠️ SSRF]
  API -->|JmxBuilder| JMX[.jmx]
  KG --> JS[.js]
```

**Уже реализовано:** auth (LDAP + local), per-user история (20), readiness score в UI, Prometheus listener в JMX.

**Следующий шаг к целевой архитектуре:**
- публикация `build.completed` в Kafka
- выгрузка `Scenario` + артефактов в S3
- allowlist URL для analyzer (app + NetworkPolicy)

---

## 4. Декларативный запуск — CRD `TestRun`

```mermaid
flowchart TB
  subgraph NS["Namespace: loadtest-run-42"]
    TR[TestRun]
    SUT[SUT]
    STUB[WireMock / Toxiproxy]
    RUN[k6 TestRun / JMeter pods]
    TR --> RUN
    RUN --> SUT
    SUT --> STUB
  end

  TR -.->|spec| SPEC["scenarioRef → S3<br/>target.baseUrl<br/>engine: k6 | jmeter<br/>profile: RPS / duration"]
```

```yaml
# целевой контракт (концепт)
apiVersion: loadtest.corp/v1
kind: TestRun
metadata:
  name: run-42
  namespace: loadtest-run-42
spec:
  scenarioRef: s3://artifacts/user42/build-abc/scenario.json
  engine: k6          # или jmeter
  target:
    baseUrl: http://sut.loadtest-run-42.svc
  profile:
    maxRps: 5000
  baselineRef: run-41   # release N-1
```

**Namespace per run** = изоляция SUT + stubs + generator + метрик прогона.

---

## 5. Оркестрация прогона (Argo Workflows)

```mermaid
flowchart LR
  E[build.completed] --> W[Argo Workflow]
  W --> D[1. Deploy SUT + stubs]
  D --> S[2. Smoke test]
  S --> L[3. TestRun load]
  L --> C[4. Collect Prometheus + Loki]
  C --> A[5. Analyze vs baseline]
  A --> R[6. Report]
  C --> T[7. Teardown namespace]
```

| Шаг | Ответственность |
|---|---|
| Deploy | Helm/Kustomize SUT + WireMock + Toxiproxy |
| Smoke | sanity до нагрузки |
| Load | k6-operator (основной) или JMeter (legacy/корреляция) |
| Collect | Prometheus + Loki |
| Analyze | p99, error rate vs baseline N-1 |
| Report | модуль 5 |
| Teardown | удаление namespace |

---

## 6. Выбор движка нагрузки

```mermaid
flowchart TD
  START[Новый прогон] --> Q{RPS > 10–20k<br/>или k8s-native?}
  Q -->|да| K6[k6-operator<br/>distributed]
  Q -->|нет| Q2{Тяжёлая корреляция<br/>JMeter plugins?}
  Q2 -->|да| JM[JMeter cluster]
  Q2 -->|нет| K6
  K6 --> POOL[node pool + taints<br/>load-generators]
  JM --> POOL
```

| Движок | Когда | Метрики |
|---|---|---|
| **k6-operator** | основной, высокий RPS, k8s | Prometheus remote write, checks |
| **JMeter** | legacy, сложная корреляция | Kolesnikov Prometheus listener ✅ |
| **WireMock** | внешние API недоступны | — |
| **Toxiproxy** | latency/timeout/partition | — |

---

## 7. Наблюдаемость и «прогноз vs факт»

```mermaid
flowchart LR
  subgraph UI["Модуль 1"]
    RS[Readiness score 85%]
  end

  subgraph RUN["Модуль 3"]
    K6[k6 / JMeter]
  end

  subgraph OBS["Модуль 4"]
    PROM[Prometheus]
    LOKI[Loki]
    BL[Baseline N-1]
    CMP[Compare p99 · errors · RPS]
    REC[Recommendations]
  end

  RS -.->|прогноз| CMP
  K6 --> PROM
  K6 --> LOKI
  PROM --> CMP
  BL --> CMP
  CMP --> REC
  REC --> RPT[Отчёт модуль 5]
```

**Readiness score (UI)** → после прогона сравнивается с фактом: «прогноз 85%, p99 = OK / FAIL».

---

## 8. Безопасность и границы

```mermaid
flowchart TB
  subgraph CORP["Corp cluster"]
    subgraph PORTAL["ns: loadtest"]
      FE[frontend]
      API[core-api]
      AN[analyzer]
    end

    subgraph RUN["ns: loadtest-run-*"]
      GEN[generators]
      SUT[SUT]
    end

    AL[URL allowlist] -.-> AN
    NP[NetworkPolicy] -.-> AN
    NP -.-> GEN
  end

  SWAGGER[Internal Swagger] -->|только allowlist| AN
  AD[LDAP/AD] --> API
```

| Риск | Контроль |
|---|---|
| SSRF (analyzer → Swagger) | allowlist доменов + NetworkPolicy egress |
| Нагрузка vs prod | отдельный node pool + taints |
| Секреты | Vault / ESO, не в PostgreSQL |
| Изоляция прогонов | namespace per run |

---

## 9. Эволюция по этапам

```mermaid
timeline
  title Roadmap платформы
  section Сейчас
    Модуль 1 : UI · Scenario · JMX/k6 · LDAP · k8s Helm
  section Q2
    S3 + Kafka : build.completed · scenarioRef
    k6 Job POC : ручной запуск из артефакта
  section Q3
    TestRun CRD : namespace per run · WireMock
    Baseline : сравнение N vs N-1
  section Q4
    Argo Workflows : полный pipeline
    Отчёты : PDF · Confluence · readiness vs fact
```

---

## Резюме

**Сейчас:** модуль 1 готовит `Scenario` и производные `.jmx`/`.js`, хранит метаданные в PostgreSQL, деплоится в k8s через Helm.

**Цель:** `Scenario` и артефакты → **S3**, событие **`build.completed`** → **Kafka** → **Argo Workflows** поднимает **namespace per run** (SUT + WireMock/Toxiproxy), **TestRun CRD** запускает **k6-operator** (основной) или **JMeter** (legacy), метрики идут в **Prometheus + Loki**, модуль 4 сравнивает с **baseline N-1** и связывает **readiness score** с фактом, модуль 5 формирует отчёт.

---

## Просмотр диаграмм локально

Mermaid-диаграммы рендерятся в:
- **VS Code / Cursor** — расширение «Markdown Preview Mermaid Support»
- **GitHub / GitLab** — при push в репозиторий
- **Онлайн** — [mermaid.live](https://mermaid.live) (скопировать блок ` ```mermaid `)

Связанные документы:
- [`platform-roadmap.md`](platform-roadmap.md)
- [`deploy/k8s.md`](deploy/k8s.md)
- [`domain-model.md`](domain-model.md)
