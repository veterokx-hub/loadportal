# Развёртывание модуля «Подготовка скрипта» в Kubernetes

Документ для DevOps/Platform-команды и архитекторов. Описывает, **что нужно от инфраструктуры**, **как установить Helm-чарт** и **как модуль 1 встраивается в общую платформу НТ**.

## Состав модуля 1 (Script Preparation)

| Pod / сервис | Образ | Назначение | Доступ извне |
|---|---|---|---|
| `frontend` | `frontend` | UI мастера | Да (Ingress `/`) |
| `constructor` | `constructor` | Auth, orchestration, история | Да (Ingress `/api`) |
| `jmeter-builder` | `jmeter-builder` | Scenario → JMX | Нет (ClusterIP) |
| `analyzer` | `analyzer` | OpenAPI/Postman → Scenario | Нет (ClusterIP) |
| `k6-generator` | `k6-generator` | Scenario → k6.js | Нет (ClusterIP) |
| `postgres` * | `postgres:16-alpine` | Пользователи, LDAP-настройки, история | Нет |

\* В production рекомендуется **managed PostgreSQL** (`externalDatabase.enabled: true`).

## Что запросить у platform-команды

### Обязательно

| # | Ресурс | Пример / комментарий |
|---|---|---|
| 1 | **Namespace** | `loadtest` или `loadtest-dev` |
| 2 | **Container registry** | `registry.corp.example/loadtest/` + `imagePullSecret` |
| 3 | **Ingress + TLS** | Host `loadtest.corp.example`, wildcard или cert-manager |
| 4 | **StorageClass** | Для PVC PostgreSQL (dev/staging) или managed DB (prod) |
| 5 | **PostgreSQL** | БД `loadtest_portal`, пользователь с DDL (Hibernate `ddl-auto: update`) |
| 6 | **DNS** | A/CNAME на Ingress controller |
| 7 | **LDAP/AD** (опционально) | URL, Base DN, service account для search — настраивается в UI |

### Желательно для production

| # | Ресурс | Зачем |
|---|---|---|
| 8 | **NetworkPolicy** | Изоляция: только Ingress → frontend/constructor; analyzer → corp API/Swagger |
| 9 | **PodDisruptionBudget** | Безопасные rolling updates |
| 10 | **Backup PostgreSQL** | История сборок и пользователи |
| 11 | **Prometheus/Grafana** | Метрики pod'ов (ServiceMonitor в values) |
| 12 | **CI/CD pipeline** | Сборка образов + `helm upgrade` |
| 13 | **Secrets management** | Vault / External Secrets Operator для паролей БД |
| 14 | **CA bundle для analyzer** | Если Swagger внутри corp с internal CA (`ANALYZER_VERIFY_SSL=true`) |

### Egress (исходящий трафик)

| Сервис | Куда | Зачем |
|---|---|---|
| `analyzer` | HTTPS Swagger/OpenAPI внутри corp | Загрузка спецификаций по URL |
| `constructor` | `jmeter-builder`, `analyzer`, `k6-generator`, PostgreSQL | Внутренний трафик |
| `frontend` | — | Только browser → Ingress |

## Архитектура в кластере

```
                    ┌─────────────────────────────────────┐
  Browser ──HTTPS──►│ Ingress (loadtest.corp.example)     │
                    │   /      → frontend:3000            │
                    │   /api   → constructor:8080            │
                    └─────────────────────────────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              ▼                       ▼                       ▼
         frontend (×2)           constructor (×2)    PostgreSQL (STS)
                                      │
                     ┌────────────────┼────────────────┐
                     ▼                ▼                ▼
              jmeter-builder   analyzer (×2)   k6-generator (×2)
              │              │
              └──────────────┴── same-origin /api (без CORS)
```

**Same-origin:** frontend собирается с `NEXT_PUBLIC_CORE_API_BASE_URL=""`, браузер ходит на `/api/*` через Ingress — не нужен отдельный публичный URL для API.

## Быстрый старт (dev/staging)

### 1. Сборка и push образов

```bash
chmod +x deploy/ci/build-and-push.sh

REGISTRY=registry.corp.example/loadtest \
TAG=0.1.0 \
NEXT_PUBLIC_CORE_API_BASE_URL="" \
./deploy/ci/build-and-push.sh
```

### 2. Secret для внешней БД (production)

```bash
kubectl create namespace loadtest

kubectl create secret generic loadtest-portal-db \
  -n loadtest \
  --from-literal=username=loadtest_app \
  --from-literal=password='CHANGE_ME' \
  --from-literal=database=loadtest_portal
```

### 3. TLS (cert-manager пример)

```yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: loadtest-portal-tls
  namespace: loadtest
spec:
  secretName: loadtest-portal-tls
  issuerRef:
    name: corp-cluster-issuer
    kind: ClusterIssuer
  dnsNames:
    - loadtest.corp.example
```

### 4. Helm install

```bash
cp deploy/helm/loadtest-portal/values-production.example.yaml values-prod.yaml
# отредактируйте host, registry, externalDatabase

helm upgrade --install loadtest-portal ./deploy/helm/loadtest-portal \
  -f values-prod.yaml \
  -n loadtest \
  --create-namespace \
  --wait
```

### 5. Проверка

```bash
kubectl get pods -n loadtest
curl -k https://loadtest.corp.example/health   # через ingress rewrite — см. constructor напрямую:
kubectl port-forward svc/loadtest-portal-constructor 8080:8080 -n loadtest
curl http://localhost:8080/health
curl -X POST http://localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin"}'
```

## Рекомендуемая стратегия для существующего кластера

### Вариант A — отдельный namespace «loadtest» (рекомендуется)

- Модуль 1 живёт изолированно.
- Модули 2–5 добавляются позже в тот же namespace или соседние (`loadtest-run`, `loadtest-report`).
- RBAC: команда НТ — `edit` в namespace, platform — `admin`.

### Вариант B — GitOps (Argo CD / Flux)

```
repo/
  deploy/helm/loadtest-portal/   ← chart
  env/
    dev/loadtest-portal.yaml     ← values overlay
    prod/loadtest-portal.yaml
```

Argo CD Application → Helm chart + values per env. Образы тегируются CI (`0.1.0`, `sha-abc123`).

### Вариант C — staging в кластере, prod на managed DB

| Среда | PostgreSQL | Replicas | LDAP |
|---|---|---|---|
| dev | Pod в кластере | 1 | выкл |
| staging | Pod или shared DB | 2 | тестовый AD |
| prod | Managed HA PostgreSQL | 2+ | prod AD |

## Чеклист перед go-live

- [ ] Сменить пароль `admin` / создать отдельных admin-пользователей
- [ ] `externalDatabase.enabled: true` + backup policy
- [ ] TLS на Ingress, HSTS
- [ ] `analyzer.verifySsl: true` + corp CA (если Swagger по HTTPS)
- [ ] NetworkPolicy: analyzer egress только к нужным CIDR/API GW
- [ ] Resource limits заданы (values.yaml)
- [ ] PDB включены для frontend и core-api
- [ ] Мониторинг `/health`, `/ready` core-api
- [ ] LDAP протестирован с service account AD
- [ ] Документирован URL для пользователей НТ

## Масштабирование

| Сервис | HPA | Комментарий |
|---|---|---|
| frontend | CPU 70% | Stateless |
| constructor | CPU 70% | Stateless; БД — bottleneck при большой истории |
| analyzer | CPU / RPS | Пик при загрузке больших OpenAPI |
| k6-generator | CPU | Пик при сборке k6 |
| postgres | — | Vertical scaling или managed DB |

## Связь с модулями 2–5

См. [`platform-roadmap.md`](../platform-roadmap.md). Модуль 1 отдаёт артефакты (`.jmx`, `.js`, JSON Scenario) — в v2 их можно сохранять в **S3/MinIO** и передавать модулю 3 через **Job CRD** или **Argo Workflows**.

## Troubleshooting

| Симптом | Причина | Решение |
|---|---|---|
| UI открывается, API 401/404 | Неверный `NEXT_PUBLIC_CORE_API_BASE_URL` | Пересобрать frontend с `""` + Ingress `/api` |
| Analyzer timeout | Swagger недоступен из pod | NetworkPolicy egress, DNS, CA |
| constructor CrashLoop | БД недоступна | Secret, initContainer wait-for-db, JDBC URL |
| LDAP не работает | AD недоступен из pod | Firewall, bind DN, search filter |

## Файлы в репозитории

```
deploy/
  helm/loadtest-portal/     Helm chart
  ci/build-and-push.sh      Сборка образов
docs/
  deploy/k8s.md             Этот документ
  platform-roadmap.md       Дорожная карта платформы
```
