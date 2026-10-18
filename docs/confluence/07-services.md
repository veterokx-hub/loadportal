# Сервисы

Общие правила внутренних вызовов: `X-Internal-Token`. Локально `LOADTEST_INTERNAL_TOKEN`, иначе `loadtest-dev-internal`. В кластере токен из Vault `loadtest/internal-token`.

Пробы: `GET /health` жив, `GET /ready` готов. У constructor дополнительно `GET /ready/strict`: 503, если сосед недоступен. Обычный `/ready` отвечает 200 и кладёт снимок зависимостей в тело.

`GET /metrics` — текст Prometheus на каждом backend. Скрейп внешний, своего VictoriaMetrics в compose нет. Описание имён: `docs/metrics.md`.

## constructor

Пакет `com.loadtest.constructor`.

| Зона | Куда смотреть |
|---|---|
| Вход и сессии | `web/AuthController`, `service/LdapAuthService` |
| Пользователи | `web/UserController` |
| Разбор спецификации | `web/AnalyzeController` → analyzer `POST /analyze` |
| Сборка | `web/BuildController` → генераторы |
| История | `web/BuildHistoryController`, `job/BuildRetentionJob` |
| Скрипты | `web/ScriptController` |
| Схема БД | `src/main/resources/db/changelog/` |

Init-job кластера — тот же jar без веба:

```
java -jar app.jar --spring.main.web-application-type=none --loadtest.db-init-exit=true
```

Job должен завершиться до старта Deployment. Иначе constructor поднимется на непрогнанной схеме и упадёт на `ddl-auto: validate`.

Bootstrap admin создаётся один раз, если пользователя `admin` ещё нет. Пустой пароль или пароль `admin` заменяется случайным и пишется в лог: `Сгенерирован пароль bootstrap-админа`. Повторный старт пароль не перезаписывает.

## orchestrator

Пакет `com.loadtest.orchestrator`.

| Зона | Куда смотреть |
|---|---|
| Создать и отменить прогон | `web/TestRunController` |
| Webhook GitLab и вердикт | `web/GitLabWebhookController` |
| Настройки GitLab | `web/GitLabSettingsController` |
| Отчёты | `web/AnalysisController` → analysis |

`POST /api/runs/webhook/gitlab` без Bearer, секрет `X-Gitlab-Token`. Это не пользовательский токен.

После терминального статуса прогона orchestrator сам ставит анализ, если заполнены cluster, namespace, service и включён `analysis/auto-on-finish`. Без цели в кластере VictoriaMetrics не к чему привязать поды: из URL стенда их не вывести.

## analyzer

`POST /analyze`. OpenAPI: путь `{param}` становится path-параметром с константой или генератором (uuid, если format uuid или имя заканчивается на `id` и тип string; randomInt для чисел). Postman: `{{name}}` и `:name` приводятся к `{name}`.

Заголовки из Postman приходят константами. На шаге корреляции constructor их не переписывает. Frontend при входе на шаг забирает `headers[]` в параметры и значение ровно `${имя}` превращает в источник «Корреляция». Это `jmeterToParamSource` в `frontend/lib/render-jmeter.ts`.

## jmeter-builder

`POST /generate/jmeter`. Сборщик `JmxBuilder`.

Группа запросов — Concurrency Thread Group и Throughput Shaping Timer. CSV Data Set или bzm Random CSV, если у датасета `random`. Счётчики вешаются на группу, `per_user`.

## k6-generator

`POST /generate/k6`. Группа — функция. Датасет — SharedArray. Маленький набор строк инлайнится, большой читается PapaParse из файла. Интенсивность — arrival rate итераций, не сырой `http_req_failed`: ошибки портала считаются своими счётчиками, когда статус 0 или check не прошёл.

## gatling-generator

`POST /generate/gatling`. Zip: `pom.xml`, `PortalSimulation.java`, CSV в `src/test/resources`. Идентификатор EL режется до `[A-Za-z0-9_]`, имя с цифры получает префикс `v_`.

Случайное целое: верхняя граница в Gatling не входит в диапазон, генератор передаёт `max + 1`, чтобы совпасть с JMeter.

## analysis

Каталоги: `analysis/app/catalog/metrics.yaml`, `rules.yaml`, `hypotheses.yaml`. Версия набора пишется в `analysis_runs.ruleset_version`.

Пустой URL VictoriaMetrics — демо-отчёт. «Пересчитать» повторяет `request_json`, это новая строка отчёта, не перезапись старой.

Разбор фаз, детекторов и вердикта: `docs/module-4-analysis.md`.
