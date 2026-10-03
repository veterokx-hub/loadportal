#!/usr/bin/env python3
"""Pre-check стадии: RUN_SPEC -> валидация -> нормализация -> .nt/run.json + .nt/run.env.

Единственное место, где принимаются решения о допустимости прогона. Дальше по
пайплайну никто не парсит «сырые» переменные портала: все джобы читают готовый
манифест .nt/run.json (машинам) и .nt/run.env (шеллу).

Коды выхода различают виновника сбоя, чтобы портал мог показать понятную причину:
  0 — прогон допустим;
  2 — нарушен контракт или политика (виноват вызывающий, повтор не поможет);
  3 — проблема окружения CI (нет файла схемы, нет зависимости — виноват runner).
"""
from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import json
import os
import re
import shutil
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

EXIT_CONTRACT = 2
EXIT_ENVIRONMENT = 3

REPO_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = REPO_ROOT / "contracts" / "run-spec.schema.json"

# Максимальная длительность по профилю: защита от «забыл убрать duration=8h в QG».
MAX_DURATION_SEC = {"smoke": 900, "qg": 1800, "load": 28800, "max-search": 28800}

# Ниже этих ресурсов генератор упирается в CFS-throttling, и замер измеряет CI, а не стенд.
MIN_CPU_MILLI_FOR_LOAD = 2000
MIN_MEMORY_MI_FOR_LOAD = 4096

# Каталог сценария копируется в артефакт pre-check, чтобы все шарды исполняли ровно
# проверенные байты. Лимит защищает от случайного копирования половины репозитория.
MAX_FROZEN_BYTES = 50 * 1024 * 1024

# Запас на отчёт и выгрузку артефактов после окончания окна.
JOB_TIMEOUT_TAIL_SEC = 600

SMOKE_AUTO_PROFILES = ("load", "max-search")

LEGACY_TOOL_EXT = {"jmeter": ".jmx", "k6": ".js", "gatling": ".zip"}
SHELL_SAFE = re.compile(r"^[A-Za-z0-9_@%+=:,./-]*$")


class ContractError(Exception):
    """Нарушение контракта или политики запуска."""


def fail(message: str, code: int = EXIT_CONTRACT) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(code)


# --- Загрузка спецификации ----------------------------------------------------------


def load_spec(spec_file: str | None) -> tuple[dict, str]:
    """Возвращает (spec, источник). Приоритет: файл -> RUN_SPEC_B64 -> RUN_SPEC -> legacy."""
    if spec_file:
        try:
            return json.loads(Path(spec_file).read_text(encoding="utf-8")), f"file:{spec_file}"
        except FileNotFoundError:
            fail(f"файл спецификации не найден: {spec_file}", EXIT_ENVIRONMENT)
        except json.JSONDecodeError as exc:
            fail(f"{spec_file}: некорректный JSON ({exc})")

    encoded = os.environ.get("RUN_SPEC_B64", "").strip()
    if encoded:
        try:
            raw = base64.b64decode(encoded, validate=True).decode("utf-8")
        except (binascii.Error, UnicodeDecodeError) as exc:
            fail(f"RUN_SPEC_B64 не декодируется как base64/utf-8: {exc}")
        try:
            return json.loads(raw), "RUN_SPEC_B64"
        except json.JSONDecodeError as exc:
            fail(f"RUN_SPEC_B64 содержит некорректный JSON: {exc}")

    inline = os.environ.get("RUN_SPEC", "").strip()
    if inline:
        try:
            return json.loads(inline), "RUN_SPEC"
        except json.JSONDecodeError as exc:
            fail(f"RUN_SPEC содержит некорректный JSON: {exc}")

    return legacy_spec(), "legacy-variables"


def legacy_spec() -> dict:
    """Сборка спецификации из плоских переменных (портал v0, ручной запуск из GitLab UI)."""
    tool = os.environ.get("TOOL", "").strip().lower()
    path = os.environ.get("SCENARIO_PATH", "").strip()
    repository = os.environ.get("REPOSITORY", "").strip().lower()

    missing = [name for name, value in (("TOOL", tool), ("SCENARIO_PATH", path), ("REPOSITORY", repository)) if not value]
    if missing:
        fail(
            "не передан ни RUN_SPEC_B64, ни минимальный набор плоских переменных; "
            f"отсутствуют: {', '.join(missing)}"
        )

    source = "s3" if os.environ.get("S3_MANIFEST_URL", "").strip() else "git"
    spec: dict = {
        "contract_version": 1,
        "run": {
            "tool": tool,
            "trigger": "portal" if os.environ.get("PORTAL_RUN_ID") else "manual",
            "profile": os.environ.get("PROFILE", "load").strip().lower() or "load",
        },
        "scenario": {"source": source, "path": path},
        "target": {"repository": repository},
    }
    checksum = os.environ.get("SCENARIO_CHECKSUM", "").strip()
    if checksum:
        spec["scenario"]["checksum"] = checksum if checksum.startswith("sha256:") else f"sha256:{checksum}"

    for env_name, section, key in (
        ("PORTAL_RUN_ID", "run", "portal_run_id"),
        ("RUN_ID", "run", "jira"),
        ("BASE_URL", "target", "base_url"),
    ):
        value = os.environ.get(env_name, "").strip()
        if value:
            spec[section][key] = value

    resources = {}
    if os.environ.get("CPU", "").strip():
        resources["cpu"] = os.environ["CPU"].strip()
    if os.environ.get("MEMORY", "").strip():
        resources["memory"] = os.environ["MEMORY"].strip()
    if os.environ.get("REPLICAS", "").strip():
        try:
            resources["replicas"] = int(os.environ["REPLICAS"])
        except ValueError:
            fail(f"REPLICAS должно быть целым числом: '{os.environ['REPLICAS']}'")
    if resources:
        spec["resources"] = resources

    start, end = os.environ.get("START_TIME", "").strip(), os.environ.get("END_TIME", "").strip()
    if start and end:
        spec["schedule"] = {"start": start, "end": end}
    elif start or end:
        fail("START_TIME и END_TIME задаются только вместе")

    # LT_QG=1 — лёгкий шаблон продуктового пайплайна (lt-ci-templates/qg.yml).
    # Полный RUN_SPEC_B64 этот путь не затрагивает: он читается раньше.
    flag = os.environ.get("LT_QG", "").strip()
    if flag == "1":
        apply_qg(spec)
    elif flag:
        fail("LT_QG принимает только значение 1")

    return spec


def env_number(name: str, kind: str) -> int | float | None:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return None
    try:
        return int(raw) if kind == "int" else float(raw)
    except ValueError:
        fail(f"{name} должно быть числом: '{raw}'")


def parse_secret_list(raw: str) -> list[dict]:
    """NAME=path@engine через запятую. Значений секретов здесь нет."""
    items = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        if "=" not in part:
            fail(f"LT_QG_SECRETS: ожидается NAME=path@engine, получено '{part}'")
        name, vault = part.split("=", 1)
        items.append({"name": name.strip(), "vault": vault.strip()})
    return items


def apply_qg(spec: dict) -> None:
    """Плоские переменные шаблона QG -> профиль qg, SLA и один генератор."""
    spec["run"]["trigger"] = "dev-pipeline"
    spec["run"]["profile"] = "qg"
    spec["run"]["smoke"] = "never"
    spec["target"]["environment"] = os.environ.get("ENVIRONMENT", "").strip() or "test"

    duration = env_number("DURATION_SEC", "int")
    load: dict = {"duration_sec": 600 if duration is None else duration}
    rps = env_number("RPS", "float")
    if rps is not None:
        load["rps"] = rps
    spec["load"] = load

    sla = {}
    for env_name, key, kind in (
        ("SLA_P95_MS", "p95_ms", "int"),
        ("SLA_P99_MS", "p99_ms", "int"),
        ("SLA_ERROR_RATE_PCT", "error_rate_pct", "float"),
        ("SLA_MIN_RPS", "min_rps", "float"),
    ):
        value = env_number(env_name, kind)
        if value is not None:
            sla[key] = value
    if not sla:
        fail(
            "профиль qg требует хотя бы один порог: "
            "SLA_P95_MS, SLA_P99_MS, SLA_ERROR_RATE_PCT или SLA_MIN_RPS"
        )
    spec["sla"] = sla

    resources = spec.setdefault("resources", {})
    resources.setdefault("cpu", "1")
    resources.setdefault("memory", "2Gi")
    if int(resources.get("replicas", 1)) != 1:
        fail("шаблон QG запускает один генератор; несколько шардов задаются полным RUN_SPEC с scenario.shardable")
    resources["replicas"] = 1

    raw_secrets = os.environ.get("LT_QG_SECRETS", "").strip()
    if raw_secrets:
        spec["secrets"] = parse_secret_list(raw_secrets)

    meta = {}
    for env_name, key in (
        ("SOURCE_PROJECT", "source_project"),
        ("SOURCE_BRANCH", "source_branch"),
        ("SOURCE_COMMIT", "source_commit"),
        ("SOURCE_PIPELINE_URL", "source_pipeline_url"),
        ("BUILD_NUMBER", "build_number"),
    ):
        value = os.environ.get(env_name, "").strip()
        if value:
            meta[key] = value
    if meta:
        spec["meta"] = meta


def check_secrets(spec: dict) -> None:
    seen = set()
    for item in spec.get("secrets") or []:
        name = item["name"]
        if name in seen:
            fail(f"секрет '{name}' указан дважды")
        seen.add(name)


def require_vault(spec: dict) -> None:
    """Пути секретов без адреса Vault исполнить нельзя: это окружение, не контракт."""
    if not spec.get("secrets"):
        return
    if not os.environ.get("LT_VAULT_SERVER_URL", "").strip():
        fail(
            "в спецификации есть secrets, а LT_VAULT_SERVER_URL не задан "
            "(переменная проекта GitLab, не триггера: дочерний пайплайн триггер не видит)",
            EXIT_ENVIRONMENT,
        )


# --- Валидация по схеме -------------------------------------------------------------


def validate_schema(spec: dict) -> None:
    try:
        import jsonschema
    except ImportError:
        fail(
            "не установлен пакет jsonschema. Это зависимость образа CI: "
            "pip install jsonschema (см. раздел предподготовки)",
            EXIT_ENVIRONMENT,
        )

    try:
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail(f"схема не найдена: {SCHEMA_PATH}", EXIT_ENVIRONMENT)

    validator = jsonschema.Draft202012Validator(schema)
    errors = sorted(validator.iter_errors(spec), key=lambda e: list(e.path))
    if not errors:
        return

    print("ERROR: RUN_SPEC не соответствует контракту v1:", file=sys.stderr)
    for error in errors[:20]:
        location = "/".join(str(part) for part in error.path) or "<корень>"
        print(f"  - {location}: {error.message}", file=sys.stderr)
    raise SystemExit(EXIT_CONTRACT)


# --- Нормализация -------------------------------------------------------------------


def default_tz() -> timezone:
    """Зона для timestamp без смещения. Явная и одна на весь пайплайн."""
    name = os.environ.get("LT_DEFAULT_TZ", "Europe/Moscow")
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo(name)  # type: ignore[return-value]
    except Exception:
        print(f"WARN: зона '{name}' недоступна (нет tzdata), использую UTC+03:00", file=sys.stderr)
        return timezone(timedelta(hours=3))


def parse_ts(value: str, field: str) -> datetime:
    normalized = value.strip().replace(" ", "T")
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        fail(f"{field}: не распознаётся как RFC 3339: '{value}'")
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=default_tz())
        print(f"WARN: {field} без часового пояса, трактую как {parsed.tzinfo}", file=sys.stderr)
    return parsed.astimezone(timezone.utc)


def dns1123(*parts: str, max_len: int = 53) -> str:
    """Имя, пригодное для Helm release и k8s-объектов. Запас до 63 — под суффиксы чарта."""
    raw = "-".join(part for part in parts if part)
    slug = re.sub(r"[^a-z0-9-]+", "-", raw.lower()).strip("-")
    slug = re.sub(r"-{2,}", "-", slug)[:max_len].strip("-")
    return slug or "lt-run"


def cpu_to_milli(value: str) -> int:
    return int(value[:-1]) if value.endswith("m") else int(float(value) * 1000)


def memory_to_mib(value: str) -> int:
    units = {"Ki": 1 / 1024, "Mi": 1, "Gi": 1024, "Ti": 1024 * 1024, "K": 1 / 1024, "M": 1, "G": 1024, "T": 1024 * 1024}
    for suffix, factor in units.items():
        if value.endswith(suffix):
            return int(float(value[: -len(suffix)]) * factor)
    return max(1, int(int(value) / (1024 * 1024)))


# --- Проверки, которые схема выразить не может --------------------------------------


def check_scenario_file(spec: dict, project_dir: Path) -> dict:
    scenario = spec["scenario"]
    result = {"resolved_path": None, "sha256": None}
    source = scenario["source"]
    if source not in ("git", "s3"):
        fail(
            f"источник сценария '{source}' допустим контрактом, но этим CI ещё не исполняется; "
            "используйте s3 или git",
            EXIT_ENVIRONMENT,
        )

    candidate = (project_dir / scenario["path"]).resolve()
    if not str(candidate).startswith(str(project_dir.resolve())):
        fail(f"путь сценария выходит за пределы репозитория: {scenario['path']}")
    if not candidate.is_file():
        if source == "s3":
            fail(
                f"сценарий не скачан из S3: {scenario['path']}. "
                "Проверьте S3_MANIFEST_URL и доступность SeaweedFS с runner"
            )
        fail(
            f"сценарий не найден в checkout: {scenario['path']}. "
            "Для git-сценария файл должен уже лежать в ref пайплайна"
        )

    digest = hashlib.sha256(candidate.read_bytes()).hexdigest()
    expected = scenario.get("checksum")
    if expected and expected != f"sha256:{digest}":
        fail(
            "checksum сценария не совпал: ожидался "
            f"{expected}, фактический sha256:{digest}. Вероятно, файл перезаписан другим прогоном"
        )

    result["resolved_path"] = str(candidate)
    result["sha256"] = f"sha256:{digest}"
    return result


def check_legacy_extension(spec: dict) -> None:
    """Дублирует правило схемы для legacy-пути с человеческим текстом ошибки."""
    tool = spec["run"]["tool"]
    path = spec["scenario"]["path"]
    expected = LEGACY_TOOL_EXT[tool]
    if not path.endswith((expected, ".zip")):
        fail(f"для {tool} ожидается сценарий {expected} (или .zip), получен '{path}'")


def resolve_smoke(spec: dict) -> dict:
    """Нужна ли стадия smoke и сколько времени ей отдать до старта нагрузки."""
    profile = spec["run"].get("profile", "load")
    mode = spec["run"].get("smoke", "auto")
    if profile == "smoke":
        enabled = True
    elif mode == "auto":
        enabled = profile in SMOKE_AUTO_PROFILES
    else:
        enabled = mode == "always"
    return {
        "enabled": enabled,
        "mode": mode,
        # Бюджет — под + JVM/сборка Maven + сама нагрузка; duration — только нагрузка.
        "budget_sec": int(os.environ.get("LT_SMOKE_BUDGET_SEC", "300")),
        "duration_sec": int(os.environ.get("LT_SMOKE_DURATION_SEC", "60")),
        "max_error_pct": float(os.environ.get("LT_SMOKE_MAX_ERROR_PCT", "0")),
    }


def smoke_only_window(smoke: dict) -> dict:
    now = datetime.now(timezone.utc)
    end = now + timedelta(seconds=smoke["duration_sec"])
    return {
        "start_utc": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "end_utc": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "start_epoch": int(now.timestamp()),
        "end_epoch": int(end.timestamp()),
        "duration_sec": smoke["duration_sec"],
        "start_lag_sec": 0,
        "job_timeout_sec": smoke["budget_sec"] + JOB_TIMEOUT_TAIL_SEC,
    }


def resolve_window(spec: dict, shards: int, smoke: dict) -> dict:
    profile = spec["run"].get("profile", "load")
    if profile == "smoke":
        return smoke_only_window(smoke)

    limit = MAX_DURATION_SEC[profile]
    schedule = spec.get("schedule")
    grace = int(os.environ.get("LT_SHARD_START_GRACE_SEC", "120"))
    max_lag = int(os.environ.get("LT_MAX_START_LAG_SEC", "900"))

    if schedule:
        start = parse_ts(schedule["start"], "schedule.start")
        end = parse_ts(schedule["end"], "schedule.end")
        if end <= start:
            fail(f"конец окна не позже начала: {schedule['start']} -> {schedule['end']}")
        duration = int((end - start).total_seconds())
    else:
        duration = int(spec.get("load", {}).get("duration_sec") or 0)
        if duration <= 0:
            fail("нужно задать либо schedule.start/end, либо load.duration_sec")
        # Шарды стартуют по общему времени: подам нужен запас на расписание и pull образа.
        # Smoke идёт до нагрузки, поэтому окно сдвигается ещё и на его бюджет.
        offset = (grace if shards > 1 else 0) + (smoke["budget_sec"] if smoke["enabled"] else 0)
        start = datetime.now(timezone.utc) + timedelta(seconds=offset)
        end = start + timedelta(seconds=duration)

    if duration > limit:
        fail(f"длительность {duration}s превышает лимит профиля '{profile}' ({limit}s)")

    lag = int((start - datetime.now(timezone.utc)).total_seconds())
    if schedule and smoke["enabled"] and lag < smoke["budget_sec"]:
        if smoke["mode"] == "always":
            fail(
                f"до начала окна {max(0, lag)}s, а smoke нужно {smoke['budget_sec']}s (run.smoke=always): "
                "сдвиньте окно или отключите smoke"
            )
        print(f"WARN: до начала окна {max(0, lag)}s — smoke не успеет и будет пропущен", file=sys.stderr)
        smoke["enabled"] = False
    if lag < -300:
        fail(f"окно началось {abs(lag)}s назад — прогон запущен слишком поздно, создайте новый")
    if lag > max_lag:
        fail(
            f"старт через {lag}s превышает LT_MAX_START_LAG_SEC={max_lag}: pod генератора "
            "держал бы слот runner'а впустую. Отложенный запуск — задача планировщика портала"
        )
    if schedule and shards > 1 and 0 <= lag < grace:
        print(
            f"WARN: до начала окна {lag}s, а шардам нужно ~{grace}s на старт — "
            "опоздавший шард сделает прогон невалидным",
            file=sys.stderr,
        )
    if lag > 0:
        print(f"INFO: генераторы дождутся начала окна (~{lag}s)")

    return {
        "start_utc": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "end_utc": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "start_epoch": int(start.timestamp()),
        "end_epoch": int(end.timestamp()),
        "duration_sec": duration,
        "start_lag_sec": max(0, lag),
        "job_timeout_sec": max(0, lag) + duration + JOB_TIMEOUT_TAIL_SEC,
    }


def check_shards(spec: dict) -> int:
    shards = int(spec.get("resources", {}).get("replicas", 1))
    if shards > 1 and not spec["scenario"].get("shardable"):
        fail(
            f"replicas={shards}, но scenario.shardable не выставлен: скрипт не умеет делить "
            "нагрузку, и каждый шард дал бы полный профиль — итог в N раз выше заказанного"
        )
    return shards


def freeze_scenario(resolved_path: str, out_dir: Path) -> str:
    """Копирует каталог сценария (скрипт + датасеты) в артефакт pre-check."""
    script = Path(resolved_path)
    source_dir = script.parent
    target_dir = out_dir / "scenario"

    # Сценарий в корне репозитория: копия каталога захватила бы сам out_dir.
    if out_dir.resolve().is_relative_to(source_dir.resolve()):
        target_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(script, target_dir / script.name)
        return str(target_dir / script.name)

    files = [path for path in source_dir.rglob("*") if path.is_file()]
    total = sum(path.stat().st_size for path in files)
    if total > MAX_FROZEN_BYTES:
        fail(
            f"каталог сценария {source_dir.name} весит {total // (1024 * 1024)} МБ "
            f"(лимит {MAX_FROZEN_BYTES // (1024 * 1024)} МБ): держите сценарий в отдельном каталоге"
        )

    if target_dir.exists():
        shutil.rmtree(target_dir)
    shutil.copytree(source_dir, target_dir)
    return str(target_dir / script.name)


def check_resources(spec: dict) -> dict:
    resources = spec.get("resources", {})
    cpu = resources.get("cpu", "2")
    memory = resources.get("memory", "4Gi")
    replicas = int(resources.get("replicas", 1))
    profile = spec["run"].get("profile", "load")

    cpu_milli, memory_mib = cpu_to_milli(cpu), memory_to_mib(memory)
    strict = os.environ.get("LT_RESOURCE_POLICY", "warn").lower() == "strict"

    if profile in ("load", "max-search"):
        problems = []
        if cpu_milli < MIN_CPU_MILLI_FOR_LOAD:
            problems.append(f"cpu={cpu} (<{MIN_CPU_MILLI_FOR_LOAD}m): CFS-throttling исказит отклики")
        if memory_mib < MIN_MEMORY_MI_FOR_LOAD:
            problems.append(f"memory={memory} (<{MIN_MEMORY_MI_FOR_LOAD}Mi): риск OOMKill генератора")
        for problem in problems:
            print(f"{'ERROR' if strict else 'WARN'}: {problem}", file=sys.stderr)
        if problems and strict:
            fail("ресурсы генератора ниже порога достоверности (LT_RESOURCE_POLICY=strict)")

    return {"cpu": cpu, "memory": memory, "replicas": replicas, "cpu_milli": cpu_milli, "memory_mib": memory_mib}


def check_policies(spec: dict) -> None:
    run = spec["run"]
    profile = run.get("profile", "load")

    if run["trigger"] == "portal" and not run.get("portal_run_id"):
        fail("trigger=portal требует run.portal_run_id — иначе портал не свяжет прогон с пайплайном")
    if profile in ("load", "max-search") and not run.get("jira"):
        fail(f"профиль '{profile}' требует run.jira — прогон без задачи НТ не отслеживается")
    if profile == "qg" and not spec.get("sla"):
        fail("профиль 'qg' без блока sla бессмысленен: гейту нечем судить о результате")
    if spec["target"].get("environment") == "preprod" and profile in ("load", "max-search"):
        print("WARN: полноценная нагрузка на preprod — убедитесь в согласовании окна", file=sys.stderr)


# --- Вывод --------------------------------------------------------------------------


def collect_ci_meta() -> dict:
    """Метаинформация GitLab: возвращается в портал как происхождение прогона."""
    mapping = {
        "ci_project": "CI_PROJECT_PATH",
        "ci_pipeline_id": "CI_PIPELINE_ID",
        "ci_pipeline_url": "CI_PIPELINE_URL",
        "ci_job_id": "CI_JOB_ID",
        "ci_commit_sha": "CI_COMMIT_SHA",
        "ci_commit_ref": "CI_COMMIT_REF_NAME",
        "ci_pipeline_source": "CI_PIPELINE_SOURCE",
        "upstream_project": "CI_PIPELINE_TRIGGERED_BY_PROJECT_PATH",
    }
    return {key: os.environ[env] for key, env in mapping.items() if os.environ.get(env)}


def write_env_file(path: Path, values: dict[str, object]) -> None:
    """Файл для `source`, не для GitLab dotenv: значения экранируются одинарными кавычками."""
    lines = [
        "# Сгенерировано ci/lib/run_spec.py. Не редактировать руками.",
        "# Подключать только через `source .nt/run.env` — artifacts:reports:dotenv",
        "# не поддерживает кавычки и пробелы и испортит эти значения.",
    ]
    for key, value in values.items():
        text = "" if value is None else str(value)
        if SHELL_SAFE.match(text):
            lines.append(f"{key}={text}")
        else:
            escaped = text.replace("'", "'\\''")
            lines.append(f"{key}='{escaped}'")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    # Без построчного сброса stdout сообщения INFO всплывают в логе job после
    # небуферизованного stderr, и причина отказа выглядит оторванной от контекста.
    sys.stdout.reconfigure(line_buffering=True)

    parser = argparse.ArgumentParser(description="Валидация и нормализация RUN_SPEC (контракт v1)")
    parser.add_argument("--spec-file", help="читать спецификацию из файла вместо переменных окружения")
    parser.add_argument("--dry-run", action="store_true", help="только схема: без файлов, политик и артефактов")
    parser.add_argument("--out-dir", default=".nt", help="каталог для run.json и run.env")
    args = parser.parse_args()

    spec, origin = load_spec(args.spec_file)
    print(f"INFO: источник спецификации — {origin}")

    declared = spec.get("contract_version")
    expected = int(os.environ.get("LT_CONTRACT_VERSION", "1"))
    if declared != expected:
        fail(f"contract_version={declared}, а CI умеет только {expected}. Обновите пайплайн или портал")

    validate_schema(spec)
    check_secrets(spec)
    if args.dry_run:
        print(f"OK: {origin} соответствует схеме (dry-run, прикладные проверки пропущены)")
        return 0

    check_legacy_extension(spec)
    check_policies(spec)
    require_vault(spec)

    project_dir = Path(os.environ.get("CI_PROJECT_DIR", os.getcwd()))
    shards = check_shards(spec)
    scenario_info = check_scenario_file(spec, project_dir)
    smoke = resolve_smoke(spec)
    window = resolve_window(spec, shards, smoke)
    resources = check_resources(spec)

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    scenario_info["local_path"] = freeze_scenario(scenario_info["resolved_path"], out_dir)

    run = spec["run"]
    short_id = (run.get("portal_run_id") or str(uuid.uuid4())).replace("-", "")[:8]
    run_label = spec.get("telemetry", {}).get("run_label") or dns1123(run.get("jira") or "adhoc", short_id, max_len=64)

    computed = {
        "short_id": short_id,
        "run_label": run_label,
        "shards": shards,
        "smoke": smoke,
        "scenario": scenario_info,
        "schedule": window,
        "resources": resources,
        "ci": collect_ci_meta(),
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

    manifest = {**spec, "computed": computed}
    (out_dir / "run.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    sla = spec.get("sla", {})
    write_env_file(
        out_dir / "run.env",
        {
            "LT_CONTRACT_VERSION": spec["contract_version"],
            "LT_MANIFEST": str(out_dir / "run.json"),
            "LT_TOOL": run["tool"],
            "LT_PROFILE": run.get("profile", "load"),
            "LT_TRIGGER": run["trigger"],
            "LT_JIRA": run.get("jira", ""),
            "LT_PORTAL_RUN_ID": run.get("portal_run_id", ""),
            "LT_RUN_LABEL": run_label,
            "LT_SCENARIO_SOURCE": spec["scenario"]["source"],
            "LT_SCENARIO_PATH": spec["scenario"]["path"],
            "LT_SCENARIO_LOCAL": scenario_info["local_path"],
            "LT_SCENARIO_SHA256": scenario_info["sha256"] or "",
            "LT_ENTRYPOINT": spec["scenario"].get("entrypoint", ""),
            "LT_SHARDS": shards,
            "LT_REPOSITORY": spec["target"]["repository"],
            "LT_BASE_URL": spec["target"].get("base_url", ""),
            "LT_ENVIRONMENT": spec["target"].get("environment", "test"),
            "LT_CPU": resources["cpu"],
            "LT_MEMORY": resources["memory"],
            "LT_REPLICAS": resources["replicas"],
            "LT_START_UTC": window["start_utc"],
            "LT_END_UTC": window["end_utc"],
            "LT_START_EPOCH": window["start_epoch"],
            "LT_END_EPOCH": window["end_epoch"],
            "LT_DURATION_SEC": window["duration_sec"],
            "LT_START_LAG_SEC": window["start_lag_sec"],
            "LT_JOB_TIMEOUT_SEC": window["job_timeout_sec"],
            "LT_SMOKE": "true" if smoke["enabled"] else "false",
            "LT_SMOKE_BUDGET_SEC": smoke["budget_sec"],
            "LT_SMOKE_DURATION_SEC": smoke["duration_sec"],
            "LT_SLA_P95_MS": sla.get("p95_ms", ""),
            "LT_SLA_P99_MS": sla.get("p99_ms", ""),
            "LT_SLA_ERROR_RATE_PCT": sla.get("error_rate_pct", ""),
            "LT_SLA_MIN_RPS": sla.get("min_rps", ""),
        },
    )

    print(
        "OK: прогон допустим\n"
        f"  инструмент : {run['tool']} / профиль {run.get('profile', 'load')}\n"
        f"  сценарий   : {spec['scenario']['path']}\n"
        f"  метка      : {run_label}\n"
        f"  шарды      : {shards}\n"
        f"  smoke      : {'да' if smoke['enabled'] else 'нет'} (run.smoke={smoke['mode']})\n"
        f"  окно       : {window['start_utc']} .. {window['end_utc']} ({window['duration_sec']}s)\n"
        f"  ресурсы    : cpu={resources['cpu']} memory={resources['memory']} replicas={resources['replicas']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
