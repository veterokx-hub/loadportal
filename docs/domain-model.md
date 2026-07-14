# Доменная модель (контракт между сервисами)

Единый JSON-контракт, которым обмениваются `frontend`, `analyzer`, `k6-generator`, `jmeter-builder` и `constructor`.
Модель **не зависит от движка** — движок выбирается на этапе сборки (JMeter `.jmx` или k6 `.js`).

## Поток данных

```
источник (OpenAPI URL/файл | Postman collection)
        │
        ▼
  analyzer.analyze()  ──►  ScenarioDraft   (список запросов + предполагаемые параметры)
        │
        ▼
  пользователь правит в UI: параметры, корреляции, интенсивность
        │
        ▼
  core-api.build(jmeter)  ──►  .jmx        (JmxBuilder, родные библиотеки JMeter)
  core-api.build(k6)      ──►  k6-generator ──►  .js
        │
        ▼
  история сборок (PostgreSQL, привязка к portal_users.username)
```

## Пользователи и доступ

| сущность | хранение | описание |
|---|---|---|
| PortalUser | `portal_users` | локальный пароль (BCrypt) или LDAP-only |
| AuthSession | `auth_sessions` | Bearer-токен, TTL 24 ч |
| PortalSettings | `portal_settings` | конфигурация LDAP AD (одна строка) |
| BuildRecord | `build_records` | снимок сценария + метаданные сборки, **scope = username** |

Аутентификация: `POST /api/auth/login` → token; все `/api/**` (кроме login) требуют `Authorization: Bearer`.

## Сущности

### Project
| поле | тип | описание |
|---|---|---|
| id | UUID | |
| name | string | |
| createdAt | datetime | |

### Scenario
| поле | тип | описание |
|---|---|---|
| id | UUID | |
| projectId | UUID | |
| name | string | |
| version | int | инкремент при сохранении |
| sourceType | enum `openapi` \| `postman` | |
| baseUrl | string | напр. `https://api.example.com` |
| threadGroup | ThreadGroupConfig | настройки нагрузки уровня сценария |
| requests | Request[] | упорядоченный список |
| createdAt | datetime | |

### ThreadGroupConfig
| поле | тип | описание |
|---|---|---|
| numThreads | int | число виртуальных пользователей |
| rampUpSec | int | время набора пользователей |
| durationSec | int | длительность теста |

> **Важно про корреляцию.** Переменные JMeter живут в рамках потока (thread).
> Поэтому весь сценарий собирается как **один пользовательский путь в одной Thread
> Group**: запросы выполняются последовательно в заданном порядке, и значение,
> извлечённое экстрактором из ответа запроса A, доступно последующим запросам.
> Интенсивность отдельного запроса задаётся **Constant Throughput Timer** на самом
> сэмплере (scope = this sampler), число потоков в группе должно покрывать
> максимальный требуемый RPS.

### Request
| поле | тип | описание |
|---|---|---|
| id | string | стабильный id внутри сценария |
| order | int | порядок выполнения |
| name | string | человекочитаемое имя (напр. `POST /login`) |
| method | enum GET/POST/PUT/PATCH/DELETE/... | |
| path | string | может содержать `{placeholder}` |
| headers | KeyValue[] | |
| queryParams | Param[] | |
| body | Body | |
| params | Param[] | все параметризуемые значения (path/query/header/body) |
| extractions | Extraction[] | корреляция-источник: что достать из ОТВЕТА этого запроса |
| intensity | Intensity | целевая нагрузка на этот запрос |

### Body
| поле | тип |
|---|---|
| mode | enum `none` \| `raw` \| `json` \| `form` |
| contentType | string |
| content | string (может содержать `${var}` и `${__fn()}`) |

### Param — как заполняется значение
| поле | тип | описание |
|---|---|---|
| name | string | имя параметра |
| location | enum `path` \| `query` \| `header` \| `body` | |
| source | ParamSource | стратегия получения значения |

### ParamSource
| kind | доп. поля | результат в JMeter |
|---|---|---|
| `constant` | `value` | литерал |
| `generator` | `generator` | функция JMeter (см. ниже) |
| `correlation` | `variable` | `${variable}` из экстрактора другого запроса |
| `csv` | `column` | `${column}` из CSV Data Set Config |

### Generator
| type | поля | JMeter-функция |
|---|---|---|
| `uuid` | — | `${__UUID()}` |
| `randomInt` | `min`, `max` | `${__Random(min,max)}` |
| `randomString` | `length`, `chars?` | `${__RandomString(length,chars)}` |
| `counter` | `start?` | `${__counter(FALSE)}` |
| `timestamp` | `format?` | `${__time(format)}` |

### Extraction — корреляция (источник)
Вешается на запрос-источник, кладёт значение из его ответа в переменную.
| поле | тип | описание |
|---|---|---|
| variable | string | имя JMeter-переменной |
| type | enum `json` \| `regex` \| `boundary` | тип экстрактора |
| expression | string | JSONPath / regex / `left\|right` |
| matchNo | int | номер совпадения (по умолчанию 1) |
| defaultValue | string | значение по умолчанию |

Запрос-приёмник ссылается на переменную через `ParamSource.kind = correlation`.

### Intensity — интенсивность на запрос
| поле | тип | описание |
|---|---|---|
| type | enum `none` \| `constant_throughput` \| `shaping` | стратегия |
| targetRps | number | целевая интенсивность, запросов/сек |
| rampUpSec | int | время выхода на targetRps (для `shaping`) |
| holdSec | int | удержание нагрузки (для `shaping`) |

Стратегии сборки в JMeter:
- `constant_throughput` — **Constant Throughput Timer** (scope=this sampler), работает на
  стандартном JMeter 5.6.3 без плагинов. `req/min = targetRps * 60`.
- `shaping` — **Concurrency Thread Group + Throughput Shaping Timer**
  (плагин `jpgc-casutg`), точный RPS с рампой/удержанием. Требует доустановки плагина.

## Пример ScenarioDraft (сокращённо)

```json
{
  "name": "example-api scenario",
  "sourceType": "openapi",
  "baseUrl": "https://api.example.com",
  "requests": [
    {
      "id": "r1", "order": 1, "name": "POST /login",
      "method": "POST", "path": "/login",
      "headers": [{"key": "Content-Type", "value": "application/json"}],
      "queryParams": [],
      "body": {"mode": "json", "contentType": "application/json",
               "content": "{\"user\":\"${username}\",\"pass\":\"${password}\"}"},
      "params": [
        {"name": "username", "location": "body",
         "source": {"kind": "csv", "column": "username"}},
        {"name": "password", "location": "body",
         "source": {"kind": "csv", "column": "password"}}
      ],
      "extractions": [
        {"variable": "authToken", "type": "json", "expression": "$.token", "matchNo": 1}
      ],
      "intensity": {"type": "constant_throughput", "targetRps": 5}
    },
    {
      "id": "r2", "order": 2, "name": "GET /profile",
      "method": "GET", "path": "/profile",
      "headers": [{"key": "Authorization", "value": "Bearer ${authToken}"}],
      "queryParams": [], "body": {"mode": "none"},
      "params": [
        {"name": "Authorization", "location": "header",
         "source": {"kind": "correlation", "variable": "authToken"}}
      ],
      "extractions": [],
      "intensity": {"type": "constant_throughput", "targetRps": 20}
    }
  ]
}
```
