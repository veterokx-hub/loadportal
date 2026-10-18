# Репозиторий

Корень: `loadtest-portal`.

```
frontend/                 Next.js, состояние сценария, Здоровье
constructor/              Spring: auth, сборка, история, Liquibase
orchestrator/             Spring: прогоны, GitLab, анализ как API
jmeter-builder/           Scenario → JMX
analyzer/                 OpenAPI и Postman → Scenario
k6-generator/             Scenario → k6
gatling-generator/        Scenario → Gatling zip
analysis/                 каталоги метрик и отчёт
ci-runner/                образы и шаблоны GitLab (lt-run, qg.yml)
config/                   Consul/Vault yaml и platform.properties
docs/                     контракты и схемы пайплайна
docs/confluence/          эти страницы
docker-compose.yml        локальный стенд портала
```

Манифестов Kubernetes в репозитории нет.

## Куда идти с задачей

| Задача | Первое место |
|---|---|
| Текст, шаг мастера, Здоровье, подсветка поля | `frontend/components`, `frontend/lib` |
| Новый пункт меню модуля | `frontend/lib/modules.ts`, `frontend/lib/routes.ts` |
| Логин, пользователи, LDAP, сборка, история | `constructor/` |
| Прогон, отмена, webhook, GitLab, постановка анализа | `orchestrator/` |
| Как `{name}` и `${var}` попадают в `.jmx` | `jmeter-builder/.../jmx/JmxBuilder.java` |
| То же для k6 | `k6-generator/app/k6_generator.py` |
| То же для Gatling | `gatling-generator/app/gatling_generator.py` |
| Импорт спецификации | `analyzer/app/openapi_parser.py`, `postman_parser.py` |
| Правила отчёта | `analysis/app/catalog/*.yaml` |
| Стадии CI, quality gate, образы генераторов | `ci-runner/` |
| Адрес модуля или TTL сборок | `config/consul-vault-config.yaml` |
| Как подключиться к Consul и Vault в кластере | `config/platform.properties` |

## Стиль кода

Java в constructor, orchestrator и jmeter-builder: Java 21-синтаксис там, где уже используется, Spring Boot 4.1, записи вместо DTO-классов, конструкторная инъекция, без `@Value` по полям сервисов, без лишних интерфейсов на одну реализацию. Схема БД только Liquibase. Проверка бизнес-правила сервиса — обычный тест без `@SpringBootTest`.

Frontend: TypeScript, тесты в `frontend/tests`. В `frontend/package.json` нет `"type": "module"`.

Python-сервисы: FastAPI, контракт сценария продублирован моделями в каждом генераторе. Меняя поле Scenario, правьте все копии и `docs/domain-model.md`.

## Что не коммитить

Пароли, токены GitLab, AppRole secret-id, дампы `scenario_json` с боевыми телами. Локальный пароль Postgres в compose (`loadtest`) — только для разработки.
