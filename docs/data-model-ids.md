# Идентификаторы платформы (модули 1 → 3 → 4 → 5)

Цепочка сущностей, на которой держатся запуск, анализ и отчёт.

```
Module 1 Сценарий          Module 3 Запуск              Module 4 / 5
─────────────────          ───────────────              ────────────
build_id  ──►  script_id  ──►  run_id  ──►  analysis / report
                 │                │
                 │                └── test_id (Jira, ввод пользователя)
                 └── git_url (опц.) / upload
```

| ID | Где появляется | Описание |
|---|---|---|
| `build_id` | Модуль 1 | Сборка сценария (снимок Scenario JSON + движок). Таблица `build_records`. |
| `script_id` | Модуль 1→3 или upload | Артефакт скрипта (`.jmx` / `.js`). Источник: генерация из сборки, загрузка вручную, позже — git. Таблица `scripts`. |
| `test_id` | Модуль 3 | Идентификатор задачи в Jira (строка, напр. `NT-1234`). Хранится в `test_runs.test_id`. |
| `run_id` | Модуль 3 | Конкретный прогон нагрузки. PK `test_runs.id`. Основа для модулей 4 и 5. |

## Таблицы

### `build_records` (как сейчас + связь со скриптом)
- `id` = **build_id**
- `username`, `scenario_name`, `engine`, `filename`, `scenario_json`, `created_at`

### `scripts` (новая)
| колонка | тип | смысл |
|---|---|---|
| `id` | UUID | **script_id** |
| `username` | varchar | владелец |
| `build_id` | UUID null | из какой сборки сгенерирован |
| `engine` | varchar | `jmeter` \| `k6` |
| `filename` | varchar | имя файла |
| `source` | varchar | `portal_build` \| `upload` \| `git` |
| `git_url` | varchar null | ссылка в git (после проливки) |
| `content` | bytea/text | тело скрипта (upload / portal) |
| `created_at` | timestamptz | |

### `test_runs` (расширение)
| колонка | тип | смысл |
|---|---|---|
| `id` | UUID | **run_id** |
| `test_id` | varchar | **Jira key** (обязателен при запуске) |
| `script_id` | UUID null | FK → scripts |
| `build_id` | UUID null | FK → build_records |
| `username`, `scenario_name`, `engine` | | метаданные |
| `target_url` | varchar | из сценария (`base_url`), не вводится заново |
| `params_json` | text | **runner params** (для JMeter: `heap_mb`; для k6 — пусто или минимум) |
| `labels_json` | text | опц. метки |
| `status`, gitlab_*, grafana_*, events, timestamps | | как раньше |

## Потоки

1. **Модуль 1 → сохранить сборку** → `build_id` (+ опционально сразу `script_id` при генерации артефакта).
2. **Модуль 1 → выгрузить скрипт** → скачивание файла (второстепенный CTA).
3. **Модуль 1 → к запуску** → переход в модуль 3 с выбранным `build_id`.
4. **Модуль 3 → upload** → новый `script_id` (`source=upload`).
5. **Модуль 3 → запуск** → новый `run_id` + ввод `test_id` + привязка `script_id`/`build_id`. Вызов GitLab — позже.
6. **Модуль 4/5** → вход только по `run_id`.

## Runner-параметры (движок)

| Движок | Параметры в UI запуска |
|---|---|
| **JMeter** | `heap_mb` — heap JVM для инстанса (`-Xmx`), по умолчанию 1024 |
| **k6** | отдельного «памяти» нет; профиль уже в скрипте → только кнопка «Запустить» |
