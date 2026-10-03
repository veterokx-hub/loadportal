"""Несекреты из Consul KV, секреты из Vault. Env остаётся, если Consul/Vault выключены."""
from __future__ import annotations

import logging
import os

import httpx

log = logging.getLogger(__name__)


def _on(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in ("1", "true", "yes", "on")


def _kv(key: str) -> str:
    if not _on("CONSUL_ENABLED"):
        return ""
    host = os.getenv("CONSUL_HOST", "localhost").strip() or "localhost"
    port = os.getenv("CONSUL_PORT", "8500").strip() or "8500"
    prefix = os.getenv("CONSUL_KV_PREFIX", "loadtest/").strip() or "loadtest/"
    if not prefix.endswith("/"):
        prefix += "/"
    headers = {}
    token = os.getenv("CONSUL_HTTP_TOKEN", "").strip()
    if token:
        headers["X-Consul-Token"] = token
    url = f"http://{host}:{port}/v1/kv/{prefix}{key}?raw"
    try:
        res = httpx.get(url, headers=headers, timeout=2.0)
    except httpx.HTTPError as ex:
        log.warning("Consul KV %s недоступен: %s", key, ex)
        return ""
    if res.status_code != 200:
        return ""
    return res.text.strip()


def _vault(path: str) -> str:
    if not _on("VAULT_ENABLED"):
        return ""
    addr = os.getenv("VAULT_ADDR", "").strip().rstrip("/")
    token = os.getenv("VAULT_TOKEN", "").strip()
    mount = os.getenv("VAULT_KV_MOUNT", "secret").strip().strip("/") or "secret"
    if not addr or not token:
        log.warning("Vault включён, но VAULT_ADDR или VAULT_TOKEN пуст")
        return ""
    url = f"{addr}/v1/{mount}/data/{path.lstrip('/')}"
    try:
        res = httpx.get(url, headers={"X-Vault-Token": token}, timeout=2.0)
    except httpx.HTTPError as ex:
        log.warning("Vault %s недоступен: %s", path, ex)
        return ""
    if res.status_code != 200:
        return ""
    data = res.json().get("data", {}).get("data", {})
    if not isinstance(data, dict) or not data:
        return ""
    if str(data.get("value", "")).strip():
        return str(data["value"]).strip()
    return str(next(iter(data.values()))).strip()


def internal_token() -> str:
    """Секрет доступа orchestrator → analysis."""
    return _vault("loadtest/internal-token") or os.getenv("LOADTEST_INTERNAL_TOKEN", "").strip()


def demo_forced() -> bool:
    raw = _kv("analysis/demo") or os.getenv("ANALYSIS_DEMO", "")
    return raw.strip().lower() in ("1", "true", "yes", "on")


def vm() -> tuple[str, int, float, str]:
    """url, concurrency, timeout_sec, bearer."""
    url = _kv("victoriametrics/url") or os.getenv("VICTORIAMETRICS_URL", "").strip()
    raw_concurrency = _kv("victoriametrics/concurrency") or os.getenv("ANALYSIS_VM_CONCURRENCY", "4")
    raw_timeout = _kv("victoriametrics/timeout-sec") or os.getenv("ANALYSIS_VM_TIMEOUT_SEC", "20")
    bearer = _vault("loadtest/victoriametrics/bearer-token") or os.getenv("VICTORIAMETRICS_BEARER", "").strip()
    try:
        concurrency = int(raw_concurrency)
    except ValueError:
        concurrency = 4
    try:
        timeout = float(raw_timeout)
    except ValueError:
        timeout = 20.0
    return url, max(concurrency, 1), timeout, bearer
