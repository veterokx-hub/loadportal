# Сопровождение

Прод — один экземпляр в тестовом кластере. Манифестов в репозитории нет. Выкладка: Argo CD меняет тег образа и синкает Application. Init-job constructor с `--loadtest.db-init-exit=true` обязан стать зелёным до Deployment. Иначе поды падают на `ddl-auto: validate`.

## Пробы

| Компонент | liveness | readiness |
|---|---|---|
| frontend | `GET /` | `GET /` |
| constructor | `GET /health` | `GET /ready` или `GET /ready/strict` |
| orchestrator, генераторы, analysis | `GET /health` | `GET /ready` |
| postgres | `pg_isready` | `pg_isready` |

`/ready` constructor отвечает 200 и в теле показывает, живы ли соседи. `/ready/strict` отдаёт 503, если сосед недоступен. На readinessProbe строгий вариант ставить только если деградация генератора должна выводить под из балансировки.

`GET /metrics` — текст Prometheus. Скрейп внешний. Имена: `docs/metrics.md`.

SSL между модулями портала нет. Analyzer ходит за Swagger без проверки сертификата.

## Что смотреть после выкладки

1. Init-job завершился, в логе нет ошибки Liquibase.
2. Constructor `/ready` содержит живые analyzer, jmeter-builder, k6-generator, gatling-generator.
3. Orchestrator `/ready` видит constructor, analysis, и при включённом прогоне — GitLab и S3.
4. Браузер открывает портал, логин проходит, `GET /api/auth/me` не 401.
5. CORS: Origin в заголовке запроса совпадает с `loadtest.cors.allowed-origins`. Иначе браузер режет ответ, хотя curl с пода проходит.
6. Смена пароля admin, если это новый инстанс. Пароль из лога bootstrap в постоянный канал не копировать.

## Секреты, без которых модуль «Запуск» мёртвый

Vault: `loadtest/gitlab/trigger-token`, `webhook-secret`, `api-token`, `loadtest/s3/access-key`, `secret-key`. Consul: `s3/endpoint`, `s3/bucket`, `s3/region`, `gitlab/base-url`, `gitlab/project-id`, `gitlab/ref`.

Без них карточки прогонов создаются и переходят в ошибку. Это ожидаемо, не падение constructor.

## Секреты анализа

Consul `victoriametrics/url`. Токен, если кластер его требует: Vault `loadtest/victoriametrics/bearer-token`. Без URL отчёт демо-режим. Grafana-ссылка в карточке прогона берётся из настроек GitLab (`GET/PUT /api/settings/gitlab`), в UI настроек экрана нет.

## Webhook

Ingress может слать `POST /api/runs/webhook/gitlab` и `POST /api/runs/webhook/verdict` сразу на orchestrator. Заголовок `X-Gitlab-Token` равен `loadtest/gitlab/webhook-secret`. Bearer пользователя там нет. Неверный секрет — 401, прогон зависнет в `running`, пока родительский webhook или ручная отмена его не закроют.

Дочерний пайплайн в этот webhook не входит. Если родитель зелёный, а вердикт пустой, смотреть publish и `verdict.json`, не статус дочернего.

## Образы генераторов нагрузки

Их собирает пайплайн `ci-runner`, не Argo портала. После trivy и cosign в логе `image-digests` четыре digest. В переменные `LT_IMAGE_*` их переносит отдельный MR. Пока digest старый, новые правки `lt-run` на под не попадут, даже если портал уже выложен.

## Бэкап

Имеет смысл снимать Postgres: пользователи, сборки, скрипты, прогоны, отчёты. S3 — копия скрипта на время прогона, не архив. VictoriaMetrics порталу не принадлежит. Черновики пользователей в бэкап не попадают.

## Чего не делать на живом инстансе

Не править схему руками. Не ставить `ddl-auto` в `update`. Не класть пароль БД и токены в ConfigMap. Не включать Consul, не прописав префикс KV: пустой префикс читает чужие ключи. Не пересобирать frontend без проверки, что `NEXT_PUBLIC_CORE_API_BASE_URL` остался пустым, если Ingress сидит на одном хосте.
