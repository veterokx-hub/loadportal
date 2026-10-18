# Пайплайн

Схемы и таблицы стадий: `docs/module-3-pipeline.md`, картинки `docs/module-3-pipeline/*.svg`. Карточка прогона и поля формы: `docs/module-3-run.md`. Здесь — что должен знать сопровождающий, не перерисовывая схемы.

## Два разных «вердикта»

| | Quality gate пайплайна | Модуль анализа |
|---|---|---|
| Считает | `verdict.py` на поде генератора | сервис analysis по VictoriaMetrics |
| Источник чисел | `kpi.jtl`, `summary.json` или `global_stats.json` | метрики сервиса под нагрузкой |
| Куда пишется | `test_runs.verdict_status`, `verdict_json` | `analysis_runs.report_json` |
| Когда пустой | Портал не кладёт блок `sla` в `RUN_SPEC` | Нет цели cluster/namespace/service или нет URL VictoriaMetrics |

Портал из UI всегда шлёт `profile=load`, `replicas=1`, сценарий `source=s3`. Пороги p95, ошибок и RPS в такой прогон не попадают. Продуктовый `qg.yml` пороги передаёт. Это разные входы в один проект GitLab.

## Цепочка из кнопки «Запуск»

1. Orchestrator читает `scripts.content`, кладёт файл в S3, пишет `test_runs` со статусом `queued`.
2. Trigger API: `RUN_SPEC_B64`, ссылка на манифест S3. `test_id` уходит как `RUN_ID`. `run_id` — как `PORTAL_RUN_ID`.
3. Родительский пайплайн: lint, pre-check, затем дочерний на подах `lt-generators`.
4. Pre-check скачивает сценарий, сверяет sha256. Код 2 — контракт, код 3 — окружение: дочерний не создаётся.
5. Для профиля load при `smoke=auto` сначала короткая итерация. Провал smoke останавливает generate и gate. В портал приходит только webhook `failed`, без `verdict.json`.
6. Generate гоняет профиль. Gate читает файл итогов. Publish шлёт `POST /api/runs/webhook/verdict` с тем же `X-Gitlab-Token`.
7. Webhook GitLab `POST /api/runs/webhook/gitlab` видит только родителя: `success` или `failed`. Дочерний игнорируется.
8. Если у прогона заполнены cluster, namespace, service и Consul `analysis/auto-on-finish` не выключен, orchestrator ставит анализ.

Отмена: `POST /api/runs/{id}/cancel` бьёт в GitLab cancel. Под получает SIGTERM через tini и дописывает `meta.json`.

`source=git` в S3 не ходит: сценарий уже в checkout репозитория НТ. `source=portal` pre-check отклоняет.

## Что читает gate

| Движок | Файл | Перцентиль | Когда шард сам failed | Запись в VictoriaMetrics |
|---|---|---|---|---|
| JMeter через Taurus | `results/shard-N/kpi.jtl` | точный p95/p99 по сэмплам | код 3, порог Taurus | Influx line protocol, если есть `LT_INFLUX_URL` |
| k6 | `summary.json` | при нескольких шардах берётся максимум, `exact=false` | код 99, threshold скрипта | remote write, если есть `K6_PROMETHEUS_RW_SERVER_URL` |
| Gatling | `global_stats.json` | `percentiles3` = p95, `percentiles4` = p99 | ненулевой код, если итоги уже есть | из `lt-run` не пишет |

Сравнение, когда блок `sla` есть: `p95_ms` и `p99_ms` и `error_rate_pct` не выше порога, `rps` не ниже `min_rps`. Нет сэмплов — `invalid`. Приоритет: `invalid`, затем `failed`, затем `passed`.

| verdict.json | Код gate | GitLab | Прогон в портале после publish |
|---|---|---|---|
| passed | 0 | зелёный | `succeeded`, текст ошибки очищен |
| failed | 1 | красный | `failed`, причины SLA в `error_message` |
| invalid | 2 | красный, GitLab не отличает от failed | `failed`, причины недостоверности |

Сбой доставки publish джобу gate не перекрашивает. Точная причина `invalid` лежит в `verdict.json`, не в цвете пайплайна.

Smoke смотрит те же файлы, но задержку не сравнивает. Нужны код 0, ошибки не выше порога и хотя бы один сэмпл. Для JMeter gate ещё сверяет имена из JMX с метками в `kpi.jtl`.

## Другие входы в тот же проект GitLab

| Вход | Что происходит |
|---|---|
| Продуктовый `qg.yml` | `profile=qg`, smoke выключен, SLA обязателен, сценарий из git |
| Run pipeline в GitLab UI | как в `RUN_SPEC` или плоских переменных |
| Merge request | только lint, пока не включён `LT_QG_ON_MR` |
| `LT_PIPELINE=images` или push `images/**` | kaniko, trivy, cosign, selftest. Портал, S3 и стенд не участвуют |

Образы генераторов (`lt-jmeter`, `lt-k6`, `lt-gatling`, `lt-ci-tools`) собирает пайплайн `ci-runner/`. Digest в git переносит отдельный MR. Это не деплой портала. Портал обновляет Argo CD по тегу образа.

## Секреты на поде

Vault отдаёт `LT_SECRET_*` только если в спецификации есть `secrets` или в шаблоне задан `LT_QG_SECRETS`. Без переменных записи в VictoriaMetrics пунктир на схеме мёртвый: JMeter и k6 просто не пишут, Gatling не пишет в любом случае.
