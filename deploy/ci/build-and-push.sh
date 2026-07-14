#!/usr/bin/env bash
# Сборка и публикация образов в корпоративный registry.
# Использование:
#   REGISTRY=registry.corp.example/loadtest TAG=0.1.0 ./deploy/ci/build-and-push.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REGISTRY="${REGISTRY:-registry.example/loadtest-portal}"
TAG="${TAG:-0.1.0}"
API_BASE_URL="${NEXT_PUBLIC_CORE_API_BASE_URL:-}"

echo "==> Building images tag=${TAG} registry=${REGISTRY}"

docker build -t "${REGISTRY}/frontend:${TAG}" \
  --build-arg "NEXT_PUBLIC_CORE_API_BASE_URL=${API_BASE_URL}" \
  "${ROOT}/frontend"

docker build -t "${REGISTRY}/constructor:${TAG}" "${ROOT}/constructor"
docker build -t "${REGISTRY}/jmeter-builder:${TAG}" "${ROOT}/jmeter-builder"
docker build -t "${REGISTRY}/analyzer:${TAG}" "${ROOT}/analyzer"
docker build -t "${REGISTRY}/k6-generator:${TAG}" "${ROOT}/k6-generator"

for img in frontend constructor jmeter-builder analyzer k6-generator; do
  docker push "${REGISTRY}/${img}:${TAG}"
done

echo "==> Done. Update Helm values:"
echo "    global.imageRegistry: ${REGISTRY}"
echo "    *.image.tag: ${TAG}"
