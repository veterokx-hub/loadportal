# Доменная модель (контракт между сервисами)

Единый JSON-контракт, которым обмениваются `frontend`, `analyzer`, `k6-generator`, `gatling-generator`, `jmeter-builder` и `constructor`.
Модель не зависит от движка. Движок выбирается при сборке: JMeter `.jmx`, k6 (`.js` или zip) или Gatling zip с Maven-проектом.

Поля JSON — **snake_case**. В Java-записях constructor те же имена в camelCase; Jackson пишет их через `spring.jackson.property-naming-strategy: SNAKE_CASE`.

## Поток данных

```
источник (OpenAPI URL/файл | Postman collection | чистый лист)
        │
        ▼
  analyzer  ──►  ScenarioDraft
        │
        ▼
  пользователь правит в UI: параметры, корреляции, интенсивность
        │
        ▼
  constructor ──► jmeter-builder      ──►  .jmx
  constructor ──► k6-generator        ──►  .js / zip
  constructor ──► gatling-generator   ──►  .zip (pom.xml + PortalSimulation.java)
        │
        ▼
  build_records + scripts
        │
        ▼
  orchestrator ──► S3 + GitLab CI ──► test_runs
        │
        ▼
  orchestrator ──► analysis ──► VictoriaMetrics
                         └──► AnalysisReport
        │
        ▼
  analysis_runs
```

## Пользователи и доступ

| сущность | хранение | описание |
|---|---|---|
| PortalUser | `portal_users` | локальный пароль (BCrypt) или LDAP-only |
| AuthSession | `auth_sessions` | Bearer-токен, TTL 3 часа |
| PortalSettings | `portal_settings` | LDAP, GitLab, Grafana |
| BuildRecord | `build_records` | снимок сценария, scope = username, до 30 на пользователя |
| Script | `scripts` | артефакт `.jmx` / `.js` / `.zip`, связь `build_id` → `script_id` |
| TestRun | `test_runs` | прогон: `test_id` (Jira), `script_id`, `run_id`, цель в кластере |
| AnalysisRun | `analysis_runs` | отчёт: вердикт, оценка, `report_json` |
| AuditEvent | `audit_events` | вход, сохранение сборки, выгрузка скрипта, старт прогона |

`POST /api/auth/login` выдаёт token. Остальные `/api/**` требуют `Authorization: Bearer`.
Без токена: login, health/ready, webhook GitLab (`X-Gitlab-Token`).

## Scenario

Живёт в UI и в `build_records.scenario_json`. Отдельной таблицы сценариев нет.

| поле | тип | описание |
|---|---|---|
| `name` | string | имя сценария |
| `source_type` | `openapi` \| `postman` | |
| `base_url` | string | например `https://api.example.com` |
| `load` | LoadConfig | режим теста и ступени |
| `datasets` | Dataset[] | CSV уровня сценария |
| `requests` | Request[] | упорядоченный список |
| `autostop` | AutoStop | пороги автоостановки |
| `prometheus` | PrometheusConfig | подпись прогона; `run_id` попадает в отчёт Gatling. Поля listener в `.jmx` больше не пишутся |

### LoadConfig

| поле | тип | описание |
|---|---|---|
| `test_mode` | `ramp_hold` \| `max_search` | постоянная нагрузка или поиск максимума |
| `steps` | int | число ступеней для `max_search` |
| `step_duration_sec` | int | длительность ступени |
| `assumed_latency_sec` | number | оценка латентности. JMeter считает из неё размер пула потоков |

Целевой RPS — HTTP-запросы в секунду, поле `intensity.target_rps` у запроса. Группа (корреляция или общий датасет) исполняется вместе. JMeter задаёт профиль Throughput Shaping Timer. k6 и Gatling инжектят итерации: `users/arrival = RPS / число HTTP за итерацию`.

### Dataset

| поле | тип |
|---|---|
| `id`, `name`, `file_name` | string |
| `columns` | string[] |
| `rows` | string[][] |
| `random` | bool |

### AutoStop

| поле | описание |
|---|---|
| `enabled` | включён ли критерий |
| `error_rate_pct`, `error_rate_sec` | доля ошибок и окно, секунды |
| `avg_response_ms`, `avg_response_sec` | средний отклик и окно, секунды |

Ноль в пороге отключает этот критерий.

### Request

| поле | тип | описание |
|---|---|---|
| `id` | string | стабильный id внутри сценария |
| `order` | int | порядок |
| `name` | string | имя сэмпла |
| `method` | string | HTTP-метод |
| `path` | string | может содержать `{name}` |
| `url` | string \| null | абсолютный URL запроса, перекрывает `base_url` + `path` |
| `headers` | KeyValue[] | |
| `query_params` | Param[] | |
| `body` | Body | |
| `params` | Param[] | path / query / header / body |
| `extractions` | Extraction[] | что достать из ответа |
| `intensity` | Intensity | нагрузка запроса |
| `validation` | Validation | код ответа и подстрока |
| `dataset_id` | string \| null | датасет группы |
| `repeat` | int | повторов за итерацию, минимум 1 |

### Body

| поле | тип |
|---|---|
| `mode` | `none` \| `raw` \| `json` \| `form` |
| `content_type` | string \| null |
| `content` | string, допускает `${var}` |

### Param

| поле | тип |
|---|---|
| `name` | string |
| `location` | `path` \| `query` \| `header` \| `body` |
| `source` | ParamSource |
| `schema_type`, `example` | string \| null, подсказки из спецификации |
| `required` | bool |
| `quoted` | bool |

### ParamSource

| `kind` | поля | смысл |
|---|---|---|
| `constant` | `value` | литерал |
| `generator` | `generator` | uuid, randomInt, randomString, counter, timestamp |
| `correlation` | `variable` | значение из экстрактора другого запроса |
| `csv` | `column` | колонка датасета |

### Generator

| `type` | поля |
|---|---|
| `uuid` | — |
| `randomInt` | `min`, `max` |
| `randomString` | `length`, `chars` |
| `counter` | `start`, `increment` |
| `timestamp` | `format` |

### Extraction

| поле | тип |
|---|---|
| `variable` | string |
| `type` | `json` \| `regex` \| `boundary` |
| `expression` | JSONPath, regex или `left\|right` |
| `match_no` | int, по умолчанию 1 |
| `default_value` | string |

### Intensity

| поле | тип |
|---|---|
| `target_rps` | number, HTTP-запросы/с |
| `ramp_up_sec` | int |
| `hold_sec` | int |

Отдельного поля стратегии нет. Режим берётся из `load.test_mode`.

### Validation

| поле | тип |
|---|---|
| `check_response_code` | bool |
| `expected_status` | int |
| `response_contains` | string |

## Пример

```json
{
  "name": "example-api",
  "source_type": "openapi",
  "base_url": "https://api.example.com",
  "load": {
    "test_mode": "ramp_hold",
    "steps": 5,
    "step_duration_sec": 60,
    "assumed_latency_sec": 1.0
  },
  "datasets": [],
  "autostop": {
    "enabled": false,
    "error_rate_pct": 0,
    "error_rate_sec": 0,
    "avg_response_ms": 0,
    "avg_response_sec": 0
  },
  "requests": [
    {
      "id": "r1",
      "order": 1,
      "name": "POST /login",
      "method": "POST",
      "path": "/login",
      "headers": [],
      "query_params": [],
      "body": {
        "mode": "json",
        "content_type": "application/json",
        "content": "{\"user\":\"${username}\"}"
      },
      "params": [
        {
          "name": "username",
          "location": "body",
          "source": {"kind": "csv", "column": "username"},
          "required": true,
          "quoted": false
        }
      ],
      "extractions": [
        {
          "variable": "authToken",
          "type": "json",
          "expression": "$.token",
          "match_no": 1,
          "default_value": ""
        }
      ],
      "intensity": {"target_rps": 5, "ramp_up_sec": 30, "hold_sec": 60},
      "validation": {
        "check_response_code": true,
        "expected_status": 200,
        "response_contains": ""
      },
      "dataset_id": null,
      "repeat": 1
    }
  ]
}
```

## AnalysisReport

Второй JSON-контракт. Его пишет сервис `analysis`, orchestrator кладёт документ в `analysis_runs.report_json`. Разбор прогона — в [`module-4-analysis.md`](module-4-analysis.md).

Поля верхнего уровня: `run_id`, `test_id`, `ruleset_version`, `generated_at`, `window_from`, `window_to`, `target` (`cluster`, `namespace`, `service`, `container`), `test_kind` (`ramp_hold` \| `max_search` \| `endurance`), `verdict` (`healthy` \| `degraded` \| `unhealthy` \| `inconclusive`), `headline`, `health_score` (0–100), `validity` (`valid`, `reasons`), `phases`, `findings`, `correlations`, `hypotheses`, `capacity`, `coverage`, `cost`, `suppressed` (список строк), `demo`, `demo_fault`.

Находка несёт `summary` с числами, `next_step`, `query` (MetricsQL) и `spark`. `coverage.score` — доля покрытых метрик в процентах. `cost` считает `queries`, `points_fetched`, `duration_ms`, `step_sec`.
