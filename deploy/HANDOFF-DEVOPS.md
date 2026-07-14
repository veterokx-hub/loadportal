# Handoff для DevOps: развёртывание Load Test Portal в corp k8s

Краткая передача: **что отдать**, **что подготовить в кластере**, **как установить**.  
Полная инструкция: [`docs/deploy/k8s.md`](../docs/deploy/k8s.md).

---

## 1. Что передать DevOps (пакет)

| Артефакт | Путь в репозитории | Зачем |
|---|---|---|
| Helm chart | `deploy/helm/loadtest-portal/` | Установка в кластер |
| Пример prod values | `deploy/helm/loadtest-portal/values-production.example.yaml` | Шаблон под corp |
| Скрипт сборки образов | `deploy/ci/build-and-push.sh` | Build & push в registry |
| Примеры Secret | `deploy/k8s/examples/secrets.example.yaml` | БД + pull secret |
| Документация деплоя | `docs/deploy/k8s.md` | Runbook |
| README | `README.md` | Обзор сервисов и портов |
| Исходники (5 сервисов) | `frontend/`, `constructor/`, `jmeter-builder/`, `analyzer/`, `k6-generator/` | Сборка образов |

**Образы (5 шт.):**

| Image | Dockerfile | Порт в контейнере | k8s kind |
|---|---|---|---|
| `…/frontend` | `frontend/Dockerfile` | 3000 | Deployment |
| `…/constructor` | `constructor/Dockerfile` | 8080 | Deployment |
| `…/jmeter-builder` | `jmeter-builder/Dockerfile` | 8081 | Deployment |
| `…/analyzer` | `analyzer/Dockerfile` | 8000 | Deployment |
| `…/k6-generator` | `k6-generator/Dockerfile` | 8001 | Deployment |
| `postgres` (optional chart) | official image | 5432 | **StatefulSet** |

**Важно для frontend:** собирать с пустым API base (same-origin через Ingress):

```bash
NEXT_PUBLIC_CORE_API_BASE_URL="" ./deploy/ci/build-and-push.sh
```

Иначе браузер будет ходить на `localhost:8080` и в corp-кластере API «сломается».

---

## 2. Что DevOps должен предоставить / настроить

### Обязательно

| # | Ресурс | Пример |
|---|---|---|
| 1 | Namespace | `loadtest` |
| 2 | Container registry + `imagePullSecret` | `registry.corp/loadtest` |
| 3 | DNS + Ingress host | `loadtest.corp.example` |
| 4 | TLS (cert-manager или готовый Secret) | `loadtest-portal-tls` |
| 5 | IngressClass | `nginx` / `traefik` / … |
| 6 | PostgreSQL (лучше managed) | host, db `loadtest_portal`, user с правом DDL |
| 7 | Secret с паролем БД | `loadtest-portal-db` (keys: `username`, `password`, `database`) |

### Желательно

| # | Ресурс | Зачем |
|---|---|---|
| 8 | Egress analyzer → внутренние Swagger/OpenAPI | Загрузка спецификаций по URL |
| 9 | Corp CA в analyzer, если HTTPS с internal CA | `analyzer.verifySsl: true` |
| 10 | NetworkPolicy | Изоляция (порты 3000/8080/8081/8000/8001/5432) |
| 11 | Backup PostgreSQL | Пользователи + история сборок |
| 12 | CI: build → push → `helm upgrade` | Повторяемые релизы |
| 13 | Consul (опционально) | Discovery/конфиг URL соседних модулей; вкл. в UI → Инфраструктура |

### LDAP (настраивается в UI после деплоя, не в Helm)

- URL AD (`ldap://` / `ldaps://`)
- Base DN, search filter `(sAMAccountName={0})` или user DN pattern
- Service account (bind DN + password), если нужен search

---

## 3. Схема трафика

```
Browser ──HTTPS──► Ingress
                      /      → frontend:3000
                      /api   → constructor:8080
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
     jmeter-builder:8081    analyzer:8000      k6-generator:8001
              │
              └──── PostgreSQL (StatefulSet / managed)
```

Снаружи публикуются **только** frontend и `/api`.  
`jmeter-builder`, analyzer и k6-generator — ClusterIP.

Разделение `constructor` ↔ `jmeter-builder`: отказ/перезапуск сборщика JMX не роняет оркестратор (логин, история, LDAP, k6).

---

## 4. Порядок установки (кратко)

```bash
# 1) Сборка и push
REGISTRY=registry.corp.example/loadtest TAG=0.1.0 \
NEXT_PUBLIC_CORE_API_BASE_URL="" \
./deploy/ci/build-and-push.sh

# 2) Namespace + secrets
kubectl create namespace loadtest
kubectl create secret docker-registry corp-registry-pull \
  -n loadtest \
  --docker-server=registry.corp.example \
  --docker-username=... --docker-password=...

kubectl create secret generic loadtest-portal-db \
  -n loadtest \
  --from-literal=username=loadtest_app \
  --from-literal=password='…' \
  --from-literal=database=loadtest_portal

# 3) Values под кластер
cp deploy/helm/loadtest-portal/values-production.example.yaml values-prod.yaml
# правка: host, registry, image tags, externalDatabase.host

# 4) Install
helm upgrade --install loadtest-portal ./deploy/helm/loadtest-portal \
  -f values-prod.yaml \
  -n loadtest --create-namespace --wait
```

**Ingress paths (уже в chart):**
- `/` → frontend  
- `/api` → constructor  

---

## 5. Ресурсы (ориентир из chart)

| Сервис | Replicas (prod example) | Requests | Limits |
|---|---:|---|---|
| frontend | 2 | 100m / 128Mi | 500m / 512Mi |
| constructor | 2 | 250m / 512Mi | 1 CPU / 1Gi |
| jmeter-builder | 2 | 100m / 256Mi | 500m / 512Mi |
| analyzer | 2 | 100m / 256Mi | 500m / 512Mi |
| k6-generator | 2 | 100m / 128Mi | 500m / 256Mi |
| postgres (если internal) | 1 (StatefulSet) | 100m / 256Mi | 500m / 512Mi + PVC 10Gi |

Для prod: **выключить internal postgres**, использовать managed DB.

---

## 6. Проверка после деплоя

```bash
kubectl get pods -n loadtest
kubectl port-forward -n loadtest svc/loadtest-portal-constructor 8080:8080

curl http://localhost:8080/health
curl -X POST http://localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin"}'
```

В браузере: `https://<ingress-host>/`  
Первый вход: **admin / admin** → **обязательная смена пароля**.  
LDAP: Настройки ⚙ → LDAP / AD (роль ADMIN).  
Consul / URL модулей: Настройки ⚙ → Инфраструктура.

---

## 7. Типичные проблемы

| Симптом | Причина | Что сделать |
|---|---|---|
| UI есть, API 404/CORS/не тот хост | Frontend собран с `localhost:8080` | Пересобрать с `NEXT_PUBLIC_CORE_API_BASE_URL=""` |
| constructor CrashLoop | БД недоступна / неверный Secret / DDL | Проверить JDBC host, secret keys; user с DDL |
| Сборка JMeter 502/503 | jmeter-builder down | Проверить pod `…-jmeter-builder`, env `JMETER_BUILDER_BASE_URL` |
| Analyzer не тянет Swagger | Нет egress / SSL CA | NetworkPolicy, `verifySsl`, CA bundle |
| ImagePullBackOff | Нет pull secret / неверный registry | `imagePullSecrets`, теги |

---

## 8. Что НЕ входит в этот деплой

Модули 2–5 (SUT, k6-operator, отчёты) — отдельно; сейчас ставится только **модуль подготовки скриптов**.  
План: `docs/module-2-plan.md`.

---

## 9. Контакты / нужные от заказчика решения

Перед установкой зафиксировать:

1. Hostname портала  
2. Registry и способ auth  
3. Managed Postgres vs chart StatefulSet  
4. Нужен ли Consul (и адрес agent/server) vs только k8s Service DNS  
5. LDAP / только локальные пользователи  
