# Конфигурация и секреты

Три файла, три роли. Секреты в git не лежат.

| Файл | Куда монтируется | Что внутри |
|---|---|---|
| `config/consul-vault-config.yaml` | ConfigMap constructor и orchestrator в k8s | URL модулей, CORS, TTL сборок, запасные флаги анализа |
| `config/consul-vault-config.local.yaml` | docker compose | То же для localhost |
| `config/platform.properties` | `/config/application.properties` или `envFrom`. Compose его не монтирует | Как достучаться до Consul и Vault: хост, порт, AppRole, префикс KV |

Приоритет URL модуля: непустой `modules.*-url`, затем Consul KV или Catalog если `consul.enabled`, затем env и DNS сервиса k8s.

Приоритет JDBC: свойство Consul `loadtest.postgres.url` и `username` (или старые ключи `postgres/url`, `postgres/username`), затем `SPRING_DATASOURCE_URL` и `SPRING_DATASOURCE_USERNAME`, затем поля yaml. Пароль: Vault `loadtest/postgres`, поле `password`. Запасной путь `loadtest/postgres/password`. Локально `SPRING_DATASOURCE_PASSWORD` (`loadtest` в compose).

Явный env перекрывает ConfigMap.

## Consul KV

Префикс `loadtest/`, если в platform не задан другой (`spring.cloud.consul.config.prefix`). Префикс должен заканчиваться на `/`. Ключи конкретные, это не документ Spring Cloud.

Несекреты:

```
s3/endpoint  s3/public-endpoint  s3/bucket  s3/region
gitlab/base-url  gitlab/project-id  gitlab/repository  gitlab/ref
ad/enabled  ad/url  ad/base-dn  ad/user-dn-pattern
ad/user-search-base  ad/user-search-filter  ad/bind-dn
victoriametrics/url  victoriametrics/concurrency  victoriametrics/timeout-sec
analysis/demo  analysis/auto-on-finish
loadtest/postgres/url  loadtest/postgres/username
```

`analysis/demo` включает синтетику без VictoriaMetrics. `analysis/auto-on-finish` включает автоотчёт после прогона. Без cluster, namespace и service автоотчёт молча не создаётся.

## Vault KV v2

Mount по умолчанию `secret`. Токен: `VAULT_TOKEN`, иначе один логин AppRole `POST /v1/auth/approle/login` по `role-id` и `secret-id` из platform.properties.

```
loadtest/postgres                 поле password
loadtest/s3/access-key            loadtest/s3/secret-key
loadtest/gitlab/trigger-token     loadtest/gitlab/webhook-secret
loadtest/gitlab/api-token
loadtest/ad/bind-password
loadtest/victoriametrics/bearer-token
loadtest/internal-token
```

`internal-token` — заголовок `X-Internal-Token` между constructor, orchestrator и генераторами. `gitlab/webhook-secret` — заголовок `X-Gitlab-Token` на webhook и на publish вердикта. `gitlab/trigger-token` — Trigger API. `gitlab/api-token` — отмена пайплайна и проверка соединения.

Пароль bootstrap-админа в проде тоже из Vault в env `LOADTEST_BOOTSTRAP_ADMIN_PASSWORD`, не из ConfigMap.

## CORS

`loadtest.cors.allowed-origins`: Origin браузера, через запятую, без слэша на конце. В k8s это адрес, который видит пользователь, не Service frontend и не `*`. Локально `http://localhost:3000,http://127.0.0.1:3000`.

## Что вшивается в образ frontend

`NEXT_PUBLIC_CORE_API_BASE_URL` пустой: браузер ходит на `/api` того же хоста. Значение берётся на `npm run build`. Смена URL constructor после сборки образа frontend ничего не меняет, пока не пересобран Next. Назначения rewrite: `CONSTRUCTOR_API_URL`, `ORCHESTRATOR_API_URL` в `next.config.mjs`.

## Локальные переключатели

Consul и Vault выключены, пока `discovery.consul.enabled` и `discovery.vault.enabled` ложь и platform.properties не подложен. GitLab для прогона: `GITLAB_TRIGGER_TOKEN`, `GITLAB_WEBHOOK_SECRET` в окружении compose. S3 и VictoriaMetrics без своих переменных локальный прогон и живой анализ не поднимут.
