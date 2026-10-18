"""Несекреты из Consul KV, секреты из Vault.

Порядок: явные CONSUL_* / VAULT_* , затем плоский ConfigMap
(spring.cloud.* и короткие дубли) из env или файла, иначе выключено.
"""
from __future__ import annotations

import base64
import logging
import os
import time
from collections.abc import Mapping

import httpx
import yaml

log = logging.getLogger(__name__)

_PLATFORM: dict[str, str] | None = None
# client_token AppRole. secret_id может не истекать, сам токен — истекает или требует renew.
_LEASE: dict[str, object] = {"token": "", "renew_at": 0.0, "hard": 0.0, "renewable": False}


def _unquote(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1].strip()
    return value


def parse_properties(text: str) -> dict[str, str]:
    parsed: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or line.startswith("!") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        parsed[key.strip()] = _unquote(value.strip())
    return parsed


def _platform() -> dict[str, str]:
    global _PLATFORM
    if _PLATFORM is None:
        path = os.getenv("LOADTEST_PLATFORM_CONFIG", "/config/application.properties").strip()
        if path and os.path.isfile(path):
            with open(path, encoding="utf-8") as fh:
                _PLATFORM = parse_properties(fh.read())
        else:
            _PLATFORM = {}
    return _PLATFORM


def _pick(environ: Mapping[str, str], props: Mapping[str, str], *keys: str) -> str:
    for key in keys:
        raw = environ.get(key)
        if raw is not None and str(raw).strip():
            return _unquote(str(raw).strip())
    for key in keys:
        raw = props.get(key, "")
        if str(raw).strip():
            return _unquote(str(raw).strip())
    return ""


def _split_host(value: str) -> tuple[str, str]:
    if ":" not in value:
        return value, ""
    host, _, port = value.rpartition(":")
    if host and port.isdigit():
        return host, port
    return value, ""


def _flag(raw: str) -> bool:
    return raw.strip().lower() in ("1", "true", "yes", "on")


def consul_settings(
    environ: Mapping[str, str] | None = None,
    props: Mapping[str, str] | None = None,
) -> tuple[bool, str, str, str, str]:
    """enabled, host, port, prefix, acl token."""
    env = os.environ if environ is None else environ
    cfg = _platform() if props is None else props
    flag = _pick(env, cfg, "CONSUL_ENABLED", "discovery.consul.enabled")
    host = _pick(env, cfg, "CONSUL_HOST", "spring.cloud.consul.host")
    port = _pick(env, cfg, "CONSUL_PORT", "spring.cloud.consul.port")
    if not host:
        glued_host, glued_port = _split_host(_pick(env, cfg, "consul_host"))
        host = glued_host
        if not port:
            port = glued_port
    prefix = _pick(
        env, cfg, "CONSUL_KV_PREFIX", "spring.cloud.consul.config.prefix", "consul_config_path"
    ) or "loadtest/"
    if not prefix.endswith("/"):
        prefix += "/"
    token = _pick(
        env, cfg, "CONSUL_HTTP_TOKEN", "spring.cloud.consul.config.acl-token", "consul_config_acl_token"
    )
    enabled = _flag(flag) if flag else bool(host)
    return enabled, host or "localhost", port or "8500", prefix, token


def vault_settings(
    environ: Mapping[str, str] | None = None,
    props: Mapping[str, str] | None = None,
) -> tuple[bool, str, str, str, str]:
    """enabled, address, kv mount, role id, secret id."""
    env = os.environ if environ is None else environ
    cfg = _platform() if props is None else props
    flag = _pick(env, cfg, "VAULT_ENABLED")
    addr = _pick(env, cfg, "VAULT_ADDR", "spring.cloud.vault.uri", "vault_uri").rstrip("/")
    mount = _pick(
        env, cfg, "VAULT_KV_MOUNT", "spring.cloud.vault.kv.backend", "vault_config_path"
    ).strip("/") or "secret"
    role = _pick(env, cfg, "VAULT_ROLE_ID", "spring.cloud.vault.app-role.role-id", "vault_role_id")
    secret = _pick(env, cfg, "VAULT_SECRET_ID", "spring.cloud.vault.app-role.secret-id", "vault_secret_id")
    enabled = _flag(flag) if flag else bool(addr)
    return enabled, addr, mount, role, secret


def _scalar(value: object) -> str:
    if value is None or isinstance(value, (dict, list, tuple)):
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value).strip()


def _document_value(text: str, dotted: str) -> str:
    """Поле `a.b.c` внутри YAML или properties документа."""
    body = (text or "").strip()
    if not body or dotted.split(".", 1)[0] not in body:
        return ""
    if "=" in body:
        found = parse_properties(body).get(dotted, "").strip()
        if found:
            return found
    if ":" not in body:
        return ""
    try:
        cursor: object = yaml.safe_load(body)
    except yaml.YAMLError:
        return ""
    for part in dotted.split("."):
        if not isinstance(cursor, dict) or part not in cursor:
            return ""
        cursor = cursor[part]
    return _scalar(cursor)


def _rest_under_key(key: str, dotted: str) -> str:
    """Ключ `victoriametrics` (или `application/victoriametrics`) и свойство `victoriametrics.url` дают `url`."""
    segments = [s for s in key.strip("/").split("/") if s]
    for start in range(len(segments)):
        head = ".".join(segments[start:])
        if head and dotted.startswith(head + "."):
            return dotted[len(head) + 1:]
    return ""


def consul_property(entries: Mapping[str, str], dotted: str) -> str:
    """Свойство из дерева префикса: отдельный ключ, ключ под контекстом, документ под ключом, документ целиком."""
    if not entries or not dotted:
        return ""
    slash = dotted.replace(".", "/")
    for exact in (entries.get(slash), entries.get(dotted)):
        if exact and exact.strip():
            return exact.strip()
    suffix = "/" + slash
    best_key = ""
    best = ""
    for key, value in entries.items():
        if not value or not value.strip() or not (key == slash or key.endswith(suffix)):
            continue
        if not best_key or len(key) < len(best_key):
            best_key, best = key, value.strip()
    if best:
        return best
    for key, value in entries.items():
        rest = _rest_under_key(key, dotted)
        if rest:
            found = _document_value(value, rest)
            if found:
                return found
    for value in entries.values():
        found = _document_value(value, dotted)
        if found:
            return found
    return ""


def relative_key(full_key: str, prefix: str) -> str | None:
    key = full_key.lstrip("/")
    base = prefix.strip("/")
    if not base:
        return key
    if key == base:
        return ""
    if not key.startswith(base + "/"):
        return None
    return key[len(base) + 1:]


def decode_tree(items: object, prefix: str) -> dict[str, str]:
    """Ответ `GET /v1/kv/<prefix>/?recurse`: Value в base64."""
    tree: dict[str, str] = {}
    if not isinstance(items, list):
        return tree
    for item in items:
        if not isinstance(item, dict):
            continue
        relative = relative_key(str(item.get("Key") or ""), prefix)
        raw = item.get("Value")
        if relative is None or not raw:
            continue
        try:
            value = base64.b64decode(raw).decode("utf-8").strip()
        except (ValueError, UnicodeDecodeError):
            log.warning("Consul KV %s не base64", item.get("Key"))
            continue
        if value:
            tree[relative] = value
    return tree


_TREE: dict[str, str] | None = None
_TREE_AT = 0.0
_TREE_TTL_SEC = 60.0
_MISSED: set[str] = set()


def _consul_headers(token: str) -> dict[str, str]:
    return {"X-Consul-Token": token} if token else {}


def _tree(host: str, port: str, prefix: str, token: str) -> dict[str, str]:
    """Дерево префикса, кеш на минуту. Если Consul не ответил — прежнее дерево."""
    global _TREE, _TREE_AT
    now = time.monotonic()
    if _TREE is not None and now - _TREE_AT < _TREE_TTL_SEC:
        return _TREE
    first = _TREE is None
    url = f"http://{host}:{port}/v1/kv/{prefix.rstrip('/')}/?recurse"
    loaded: dict[str, str] | None
    try:
        res = httpx.get(url, headers=_consul_headers(token), timeout=2.0)
        if res.status_code == 404:
            loaded = {}
            if first:
                log.warning("Consul KV %s -> 404, в префиксе нет ключей", url)
        elif res.status_code != 200:
            loaded = None
            log.warning("Consul KV %s -> HTTP %s", url, res.status_code)
        else:
            loaded = decode_tree(res.json(), prefix)
            if first:
                log.info("Consul KV %s -> ключи %s", url, sorted(loaded))
    except (httpx.HTTPError, ValueError) as ex:
        loaded = None
        log.warning("Consul KV %s недоступен: %s", url, ex)
    if loaded is not None:
        _TREE = loaded
    elif _TREE is None:
        _TREE = {}
    _TREE_AT = time.monotonic()
    return _TREE


def _kv_exact(host: str, port: str, prefix: str, token: str, key: str) -> str:
    url = f"http://{host}:{port}/v1/kv/{prefix}{key}?raw"
    try:
        res = httpx.get(url, headers=_consul_headers(token), timeout=2.0)
    except httpx.HTTPError as ex:
        log.warning("Consul KV %s недоступен: %s", key, ex)
        return ""
    if res.status_code != 200:
        if res.status_code != 404:
            log.warning("Consul KV %s -> HTTP %s", key, res.status_code)
        return ""
    return res.text.strip()


def _kv(key: str) -> str:
    """Отдельный ключ, иначе `a.b` или `loadtest.a.b` в дереве префикса."""
    enabled, host, port, prefix, token = consul_settings()
    if not enabled or not key:
        return ""
    exact = _kv_exact(host, port, prefix, token, key)
    if exact:
        return exact
    dotted = key.replace("/", ".")
    entries = _tree(host, port, prefix, token)
    found = consul_property(entries, dotted)
    if not found and not dotted.startswith("loadtest."):
        found = consul_property(entries, "loadtest." + dotted)
    if not found and key not in _MISSED:
        _MISSED.add(key)
        log.warning("Consul: %s нет в префиксе %s", key, prefix)
    return found


def vault_renew_at(now: float, lease_seconds: int) -> float:
    """Середина lease, но не позже чем за 30 с до конца. 0 — токен без срока."""
    if lease_seconds <= 0:
        return float("inf")
    ttl = float(lease_seconds)
    half = now + ttl / 2
    latest = now + max(0.0, ttl - 30.0)
    return min(half, latest)


def _remember_auth(auth: Mapping[str, object]) -> str:
    token = str(auth.get("client_token") or "").strip()
    if not token:
        return ""
    lease = int(auth.get("lease_duration") or 0)
    now = time.monotonic()
    _LEASE["token"] = token
    _LEASE["renewable"] = bool(auth.get("renewable"))
    _LEASE["renew_at"] = vault_renew_at(now, lease)
    _LEASE["hard"] = (now + lease) if lease > 0 else float("inf")
    return token


def _forget_token() -> None:
    _LEASE["token"] = ""
    _LEASE["renew_at"] = 0.0
    _LEASE["hard"] = 0.0
    _LEASE["renewable"] = False


def _login(addr: str, role: str, secret: str) -> str:
    if not addr or not role or not secret:
        return ""
    try:
        res = httpx.post(
            f"{addr}/v1/auth/approle/login",
            json={"role_id": role, "secret_id": secret},
            timeout=2.0,
        )
    except httpx.HTTPError as ex:
        log.warning("Vault AppRole login недоступен: %s", ex)
        return ""
    if res.status_code != 200:
        log.warning("Vault AppRole login -> HTTP %s", res.status_code)
        return ""
    return _remember_auth(res.json().get("auth") or {})


def _renew(addr: str, token: str) -> str:
    try:
        res = httpx.post(
            f"{addr}/v1/auth/token/renew-self",
            headers={"X-Vault-Token": token},
            timeout=2.0,
        )
    except httpx.HTTPError as ex:
        log.warning("Vault renew-self недоступен: %s", ex)
        return ""
    if res.status_code != 200:
        log.warning("Vault renew-self -> HTTP %s", res.status_code)
        return ""
    return _remember_auth(res.json().get("auth") or {})


def _lookup_self(addr: str, token: str) -> str:
    """ok — lease записан. dead — токен отвергнут. unknown — lookup не удался."""
    try:
        res = httpx.get(
            f"{addr}/v1/auth/token/lookup-self",
            headers={"X-Vault-Token": token},
            timeout=2.0,
        )
    except httpx.HTTPError as ex:
        log.warning("Vault lookup-self недоступен: %s", ex)
        return "unknown"
    if res.status_code in (401, 403):
        return "dead"
    if res.status_code != 200:
        log.warning("Vault lookup-self -> HTTP %s", res.status_code)
        return "unknown"
    data = res.json().get("data") or {}
    ttl = int(data.get("ttl") or 0)
    now = time.monotonic()
    _LEASE["token"] = token
    _LEASE["renewable"] = bool(data.get("renewable"))
    _LEASE["renew_at"] = vault_renew_at(now, ttl)
    _LEASE["hard"] = (now + ttl) if ttl > 0 else float("inf")
    return "ok"


def _vault_token(addr: str, role: str, secret: str) -> str:
    now = time.monotonic()
    token = str(_LEASE["token"] or "")
    if token and now < float(_LEASE["renew_at"]):
        return token
    if token and _LEASE["renewable"] and now < float(_LEASE["hard"]):
        renewed = _renew(addr, token)
        if renewed:
            return renewed
        _forget_token()
        token = ""
    env = os.getenv("VAULT_TOKEN", "").strip()
    if env and (not token or token == env):
        status = _lookup_self(addr, env)
        if status == "unknown":
            _LEASE["token"] = env
            _LEASE["renewable"] = False
            _LEASE["renew_at"] = time.monotonic() + 60
            _LEASE["hard"] = float("inf")
            return env
        if status == "ok":
            if time.monotonic() < float(_LEASE["renew_at"]):
                return env
            if _LEASE["renewable"] and time.monotonic() < float(_LEASE["hard"]):
                renewed = _renew(addr, env)
                if renewed:
                    return renewed
            return str(_LEASE["token"] or env)
        log.warning("Vault: VAULT_TOKEN отклонён, логин AppRole")
    return _login(addr, role, secret)


def _pick_field(data: Mapping[str, object], dotted: str) -> str:
    if not dotted:
        return ""
    direct = _scalar(data.get(dotted))
    if direct:
        return direct
    cursor: object = data
    for part in dotted.split("."):
        if not isinstance(cursor, dict):
            return ""
        cursor = cursor.get(part)
    return _scalar(cursor)


def vault_field(data: object, remainder: str, full_dotted: str) -> str:
    """Точный путь: `value` или единственное поле. Родительский секрет: поле по остатку пути."""
    if not isinstance(data, dict):
        return ""
    if not remainder:
        value = _scalar(data.get("value"))
        if value:
            return value
        scalars = [s for s in (_scalar(v) for v in data.values()) if s]
        if len(scalars) == 1:
            return scalars[0]
        return _pick_field(data, full_dotted)
    found = _pick_field(data, remainder)
    if found:
        return found
    if full_dotted and full_dotted != remainder:
        return _pick_field(data, full_dotted)
    return ""


def vault_candidates(path: str) -> list[tuple[str, str]]:
    """(путь секрета, поле): `a/b/c` → (`a/b/c`, ``), (`a/b`, `c`), (`a`, `b.c`), затем контексты."""
    parts = [p for p in path.strip("/").split("/") if p]
    out: list[tuple[str, str]] = []
    for i in range(len(parts), 0, -1):
        out.append(("/".join(parts[:i]), ".".join(parts[i:])))
    full = ".".join(parts)
    short = full[len("loadtest."):] if full.startswith("loadtest.") else full
    for context in ("application", "loadtest-portal"):
        if all(context != c[0] for c in out):
            out.append((context, short))
    return out


_VAULT_MISSED: set[str] = set()


def _vault(path: str) -> str:
    enabled, addr, mount, role, secret = vault_settings()
    if not enabled or not path:
        return ""
    token = _vault_token(addr, role, secret)
    if not addr or not token:
        log.warning("Vault включён, но адрес или токен пуст")
        return ""
    value, denied = _vault_read(addr, mount, path, token)
    if denied:
        used = token
        _forget_token()
        token = _vault_token(addr, role, secret)
        if token and token != used:
            log.info("Vault AppRole: новый client_token после HTTP 403")
            value, _denied = _vault_read(addr, mount, path, token)
    return value


def _vault_read(addr: str, mount: str, path: str, token: str) -> tuple[str, bool]:
    full = path.strip("/").replace("/", ".")
    tried: list[str] = []
    for secret_path, remainder in vault_candidates(path):
        tried.append(secret_path)
        url = f"{addr}/v1/{mount}/data/{secret_path}"
        try:
            res = httpx.get(url, headers={"X-Vault-Token": token}, timeout=2.0)
        except httpx.HTTPError as ex:
            log.warning("Vault %s недоступен: %s", secret_path, ex)
            return "", False
        if res.status_code == 404:
            continue
        if res.status_code == 403:
            log.warning("Vault %s -> HTTP 403: %s", secret_path, res.text[:180].replace("\n", " "))
            return "", True
        if res.status_code != 200:
            log.warning("Vault %s -> HTTP %s", secret_path, res.status_code)
            return "", False
        try:
            data = (res.json().get("data") or {}).get("data") or {}
        except ValueError:
            continue
        value = vault_field(data, remainder, full)
        if value:
            log.info("Vault %s поле %s", secret_path, remainder or "value")
            return value, False
    if path not in _VAULT_MISSED:
        _VAULT_MISSED.add(path)
        log.warning("Vault секрет %s не найден в %s, смотрели %s", path, mount, ", ".join(tried))
    return "", False


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
