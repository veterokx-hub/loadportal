# Локальная разработка

## Поднять стенд

Из корня репозитория:

```bash
docker compose up --build
```

Демон Docker на этой машине: сокет `unix:///Users/nvkhakimov/.docker/run/docker.sock`. Песочница IDE его не видит, команде нужны права вне песочницы.

| URL | Что |
|---|---|
| http://localhost:3000 | Портал |
| http://localhost:8080 | constructor |
| http://localhost:8082 | orchestrator |
| http://127.0.0.1:8081/ready | jmeter-builder |
| http://127.0.0.1:8000/docs | analyzer |
| http://127.0.0.1:8001/docs | k6-generator |
| http://127.0.0.1:8002/docs | gatling-generator |
| http://127.0.0.1:8003/docs | analysis |

Генераторы слушают только localhost. `/analyze` и `/generate` без `X-Internal-Token` не отвечают. Локальное значение токена: `loadtest-dev-internal`, если `LOADTEST_INTERNAL_TOKEN` не задан.

Postgres: `127.0.0.1:5432`, база `loadtest`, пользователь и пароль `loadtest`.

Первый вход: `admin`. Пароль из `LOADTEST_BOOTSTRAP_ADMIN_PASSWORD` или строка в логе constructor `Сгенерирован пароль bootstrap-админа`. После входа портал требует сменить пароль. Уже существующий admin повторным стартом не перезаписывается. Чтобы получить пароль заново, пользователя надо удалить из БД.

Только UI:

```bash
docker compose up -d --build frontend
```

`NEXT_PUBLIC_*` вшивается при сборке образа. Правка текста в `frontend/` без `--build` в контейнер не попадёт.

## Тесты frontend

Системного `node` в PATH нет. Бинарь Cursor:

`/Applications/Cursor.app/Contents/Resources/app/resources/helpers/node`

Из каталога `frontend`:

```bash
/Applications/Cursor.app/Contents/Resources/app/resources/helpers/node \
  --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
  --experimental-strip-types \
  --import ./tests/register.mjs \
  --test tests/lib.test.ts tests/text.test.ts
```

В `frontend/package.json` не добавлять `"type": "module"`.

## Тесты Java

Сервис без Spring-контекста: моки в конструктор. `@SpringBootTest` на правило Здоровья или разбор имени переменной не нужен. Схему меняет только новый changelog Liquibase.

## Тесты Python

Каталоги `analyzer/tests`, `k6-generator/tests`, `gatling-generator/tests`, `analysis/tests`. Контракт CI k6: `k6-generator/tests/test_ci_contract.py`.

## Что локально не работает без секретов

Карточка прогона создаётся. До GitLab она дойдёт только с `GITLAB_TRIGGER_TOKEN` и `GITLAB_WEBHOOK_SECRET`, плюс доступный S3. Анализ без `victoriametrics/url` показывает демо, если включены галочка или `analysis/demo`.

Черновик сценария в браузере пользователя. Инструмент проверки UI логинится отдельно и чужой `localStorage` не видит. Пароль для такой проверки не выдумывать.

## Правка одного сервиса

Compose-сервисы собираются своими Dockerfile. После правки Java или Python пересобирается соответствующий сервис, не весь стек. Frontend для видимого изменения в браузере — всегда `--build frontend`.
