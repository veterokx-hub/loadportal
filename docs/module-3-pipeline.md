# Схема пайплайна: сценарии, интеграции, вердикт

Вердикт quality gate считается по файлам итогов на поде генератора. VictoriaMetrics в этот расчёт не входит: туда уходит живая телеметрия для Grafana и модуля анализа.

## Кто с кем говорит

![Кто с кем говорит](module-3-pipeline/01-integrations.svg)

```mermaid
flowchart LR
  UI["Портал UI"] --> ORC["orchestrator"]
  QG["Продуктовый пайплайн<br/>include qg.yml"] --> GL["GitLab, проект НТ"]
  WEB["Run pipeline"] --> GL
  MR["Merge request"] --> GL
  ORC -->|"скрипт"| S3[("S3")]
  ORC -->|"Trigger API<br/>RUN_SPEC_B64"| GL

  GL --> PARENT["Родитель:<br/>lint, pre-check, load"]
  PARENT -->|"child.yml<br/>strategy depend"| CHILD["Дочерний пайплайн"]
  PARENT --> CTRL["поды lt-control"]
  CHILD --> CTRL
  CHILD --> GEN["поды lt-generators"]

  CTRL -->|"presigned GET"| S3
  VAULT[("Vault")] -.->|"LT_SECRET_*"| GEN
  GEN -->|"HTTP нагрузки"| SUT["стенд dev/test/stage/preprod"]
  GEN -.->|"Influx или remote write"| VM[("VictoriaMetrics")]
  VM --> GRAF["Grafana"]
  VM --> AN["Модуль анализа"]

  CTRL -->|"POST /webhook/verdict"| ORC
  GL -->|"webhook пайплайна<br/>только родитель"| ORC
  ORC -->|"autoAnalyze,<br/>если задан target service"| AN
```

Пунктир есть только когда заданы переменные. Без `LT_INFLUX_URL` JMeter в VictoriaMetrics не пишет. Без `K6_PROMETHEUS_RW_SERVER_URL` k6 туда не пишет. Gatling из `lt-run` в VictoriaMetrics не пишет вообще. Секреты появляются только если в спецификации есть `secrets` или в шаблоне задан `LT_QG_SECRETS`.

## Какой сценарий какие стадии включает

![Какой сценарий какие стадии включает](module-3-pipeline/02-scenarios.svg)

```mermaid
flowchart TD
  EV["Событие GitLab"] --> SRC{источник}

  SRC -->|trigger| PORTAL["Портал: profile=load,<br/>сценарий из S3, 1 шард"]
  SRC -->|pipeline| PROD["qg.yml: profile=qg,<br/>smoke выключен, SLA обязателен"]
  SRC -->|web| MANUAL["RUN_SPEC или плоские переменные"]
  SRC -->|merge request| LINT["только lint"]
  SRC -->|"web и LT_PIPELINE=images<br/>или push каталога images"| BUILD["kaniko, trivy, cosign, selftest"]

  PORTAL --> PRE["pre-check"]
  PROD --> PRE
  MANUAL --> PRE
  PRE -->|код 2 контракт<br/>или 3 окружение| STOP["дочерний не создаётся,<br/>генераторы свободны"]
  PRE --> CH["child.yml, resource_group lt-generators"]

  CH --> PROF{профиль}
  PROF -->|smoke| S1["smoke → gate → publish"]
  PROF -->|qg, либо smoke=never| S2["generate → gate → publish"]
  PROF -->|"load и max-search,<br/>smoke=auto"| S3["smoke → smoke-check → generate → gate → publish"]
```

`load` и `max-search` отличаются лимитом длительности и тем, что для них обязателен `run.jira`. Стадии одни и те же. Если до начала окна меньше бюджета smoke, режим `auto` пропускает smoke и идёт сразу в `generate`.

Портал сейчас всегда шлёт `profile=load`, `replicas=1` и сценарий `source=s3`. Блока `sla` в этом запросе нет. Пороги p95, ошибок и RPS в такой прогон не попадают, пока их не добавят в `RUN_SPEC`.

| Вход | CI_PIPELINE_SOURCE | Что получает pre-check | Стадия smoke | Нагрузка | Пороги SLA | Обратно в портал |
|---|---|---|---|---|---|---|
| Портал UI / API | trigger | load, сценарий из S3, 1 шард | да, auto | да | нет, пока launcher не кладёт sla | webhook плюс publish, если задан callback |
| Продуктовый qg.yml | pipeline | qg, сценарий из git репозитория НТ, 1 шард | нет | да | да, пороги LT_QG_* | статус GitLab. publish в портал только при callback |
| Run pipeline в GitLab | web | как в RUN_SPEC или плоских переменных | auto по профилю | кроме profile=smoke | если блок sla есть в спецификации | publish, если есть portal_run_id и callback |
| Merge request | merge_request_event | только lint | нет | нет | нет | нет |
| Сборка образов | web LT_PIPELINE=images или push images/** | kaniko, trivy, cosign, selftest | нет | нет | нет | нет |

## Прогон из портала, все вызовы

![Прогон из портала, все вызовы](module-3-pipeline/03-portal-sequence.svg)

```mermaid
sequenceDiagram
  actor User
  participant Portal as Портал
  participant S3
  participant GL as GitLab родитель
  participant PC as pre-check
  participant CH as Дочерний
  participant Gen as Генератор
  participant SUT as Стенд
  participant VM as VictoriaMetrics
  participant Gate as gate

  User->>Portal: создать прогон
  Portal->>S3: скрипт и presigned manifest
  Portal->>GL: Trigger API, RUN_SPEC_B64, S3_MANIFEST_URL
  GL->>PC: стадия pre-check
  PC->>S3: скачать сценарий, сверить sha256
  PC->>GL: артефакт .nt и child.yml
  GL->>CH: trigger, strategy depend

  CH->>Gen: smoke, LT_MODE=smoke, 1 под
  Gen->>SUT: около 1 итерации/с
  Gen-->>VM: запись, если задан URL
  CH->>Gate: smoke-check, verdict.py
  alt smoke провален
    Note over CH,Portal: generate, gate и publish не стартуют
    GL->>Portal: webhook failed
  else smoke пройден
    CH->>Gen: generate, N шардов, барьер по времени
    Gen->>SUT: профиль нагрузки
    Gen-->>VM: запись, если задан URL
    CH->>Gate: kpi.jtl или summary.json или global_stats.json
    Gate->>GL: код 0, 1 или 2 и junit.xml
    CH->>Portal: POST /api/runs/webhook/verdict
    GL->>Portal: webhook success или failed
    Portal->>Portal: анализ, если заполнен target service
  end
```

Отмена идёт отдельным вызовом: портал бьёт в GitLab API cancel, под получает SIGTERM через tini, инструмент успевает дописать `meta.json`.

Ручной запуск повторяет эту цепочку после `pre-check`. Сценарий `source=git` уже лежит в checkout, в S3 pre-check не ходит. `source=portal` pre-check отклоняет.

## Продуктовый quality gate

![Продуктовый quality gate](module-3-pipeline/04-qg-sequence.svg)

```mermaid
sequenceDiagram
  participant Prod as Продуктовый пайплайн
  participant GL as Проект НТ
  participant PC as pre-check
  participant Gen as Генератор
  participant Gate as gate
  participant Portal as Портал

  Prod->>Prod: lt-qg-check, порог SLA задан
  Prod->>GL: trigger strategy depend, LT_QG=1
  Note over GL: переменные TOOL, SCENARIO_PATH,<br/>BASE_URL, SLA_*, SOURCE_*
  GL->>PC: profile=qg, smoke=never, 1 шард
  PC->>PC: сценарий из git этого репозитория
  GL->>Gen: generate, без стадии smoke
  Gen->>Gate: файл итогов
  Gate->>Gate: сравнить p95, p99, ошибки, RPS с sla
  Gate-->>Prod: зелёный только при коде 0
  opt заданы callback URL и токен
    GL->>Portal: POST verdict.json
  end
```

Для продукта гейт — это статус джобы `lt-quality-gate`. `passed` оставляет пайплайн зелёным. `failed` и `invalid` оба делают его красным: GitLab не различает коды 1 и 2. Точная причина лежит в `verdict.json` и в портале, если callback дошёл.

На merge request продуктовый шаблон гейт не запускает, пока не включён `LT_QG_ON_MR`.

## Откуда берутся числа для вердикта

![Откуда берутся числа для вердикта](module-3-pipeline/05-metrics.svg)

```mermaid
flowchart LR
  subgraph pod [Под генератора]
    JM["JMeter через Taurus"]
    K6["k6"]
    GA["Gatling mvn -o"]
  end

  JM --> JTL["results/shard-N/kpi.jtl"]
  K6 --> SUM["summary.json"]
  GA --> GS["global_stats.json"]
  JM --> META["meta.json, код выхода"]
  K6 --> META
  GA --> META

  JTL --> GATE["gate: verdict.py"]
  SUM --> GATE
  GS --> GATE
  META --> GATE
  SLA["sla из RUN_SPEC"] --> GATE

  GATE --> OUT["verdict.json и junit.xml"]

  JM -.-> VM[("VictoriaMetrics :8428")]
  K6 -.-> VM
  VM --> GRAF["Grafana по run_label / testid"]
  VM --> AN["Анализ сервиса под нагрузкой"]
```

| Инструмент | Что читает gate | Перцентиль | Когда шард сам становится failed | Живая запись в VictoriaMetrics |
|---|---|---|---|---|
| JMeter | `kpi.jtl` | точный p95/p99 по всем сэмплам шардов | код 3, порог Taurus | Influx line protocol, если задан `LT_INFLUX_URL` |
| k6 | `summary.json`, поля `p(95)` и `p(99)` | при нескольких шардах максимум, `exact=false` | код 99, threshold в скрипте | remote write, если задан `K6_PROMETHEUS_RW_SERVER_URL` |
| Gatling | `global_stats.json` | `percentiles3` это p95, `percentiles4` это p99 | любой ненулевой код, если итоги уже есть | из `lt-run` не пишет |

Сравнение одно: `p95_ms` и `p99_ms` и `error_rate_pct` не выше порога, `rps` не ниже `min_rps`. Нет сэмплов или нет нужной метрики — `invalid`. Приоритет статуса: `invalid`, затем `failed`, затем `passed`.

| verdict.json | Код gate | GitLab и продуктовый пайплайн | Прогон в портале после publish |
|---|---|---|---|
| passed | 0 | зелёный | SUCCEEDED, error очищен |
| failed | 1 | красный | FAILED, причины SLA в error |
| invalid | 2 | красный, как failed | FAILED, причины недостоверности в error |

Publish ходит на `POST /api/runs/webhook/verdict` с тем же `X-Gitlab-Token`, что webhook пайплайна. Сбой доставки не перекрашивает gate. Webhook GitLab игнорирует дочерний пайплайн и видит только success или failed родителя.

Smoke перед нагрузкой смотрит те же файлы, но SLA по задержке не применяет. Нужен код 0, ошибки не выше порога и хотя бы один сэмпл. Для JMeter gate ещё сверяет имена из JMX с метками в `kpi.jtl`. У k6 и Gatling покрытие сидит в самом скрипте: thresholds и assertions, то есть в коде выхода.

Провал этого smoke останавливает цепочку раньше gate. `generate` зависит от `smoke-check`, у `gate` зависимость не optional, поэтому `gate` и `publish` не запускаются. Портал получает только webhook `failed`, без `verdict.json`.

## Сборка образов

Это отдельный пайплайн того же репозитория. Портал, S3, стенд и Vault сценария в нём не участвуют.

![Сборка образов](module-3-pipeline/06-images.svg)

```mermaid
flowchart LR
  TR["LT_PIPELINE=images<br/>или push images/**"] --> BASE["kaniko lt-base<br/>тег lt-images, root"]
  BASE --> JM2["lt-jmeter"]
  BASE --> K62["lt-k6"]
  BASE --> GA2["lt-gatling"]
  BASE --> TL["lt-ci-tools"]
  JM2 --> SCAN["trivy HIGH,CRITICAL"]
  K62 --> SCAN
  GA2 --> SCAN
  TL --> SCAN
  SCAN --> SIGN["cosign, без rekor"]
  SCAN --> SELF["selftest на lt-control, uid 10001"]
  SIGN --> DIG["лог четырёх digest"]
  SELF --> DIG
```

`image-digests` печатает строки для `LT_IMAGE_*`. В git их переносит отдельный MR.
