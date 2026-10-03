#!/usr/bin/env python3
"""Генерация дочернего пайплайна прогона: .nt/run.json -> .nt/child.yml.

Дочерний пайплайн нужен потому, что `parallel` в GitLab принимает только литерал:
число шардов, образ генератора и ресурсы пода известны лишь после pre-check.

Структура:
  smoke    — 1 под, минимальная нагрузка: скрипт исполним, каждый запрос проходит;
             smoke-check оценивает его и пропускает generate дальше;
  generate — N подов-генераторов на runner'е lt-generators (pod джобы = генератор);
  gate     — сводный вердикт на runner'е lt-control;
  publish  — доставка verdict.json в портал. Сбой доставки не меняет статус gate.

Секреты из spec.secrets попадают только в поды генераторов (smoke и generate):
GitLab сам ходит в Vault и кладёт значения в LT_SECRET_*. gate и publish их не видят.
profile=smoke — smoke, gate и publish, без нагрузки.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

EXIT_ENVIRONMENT = 3

TOOL_IMAGE_VARS = {"jmeter": "LT_IMAGE_JMETER", "k6": "LT_IMAGE_K6", "gatling": "LT_IMAGE_GATLING"}

PRE_CHECK_NEED = ["    - pipeline: $PARENT_PIPELINE_ID", "      job: pre-check"]


def q(value: object) -> str:
    """JSON-строка — валидный YAML-скаляр в двойных кавычках: экранирование бесплатно."""
    return json.dumps(str(value), ensure_ascii=False)


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        hint = (
            "ссылка на образ по digest в .gitlab-ci.yml"
            if name.startswith("LT_IMAGE_")
            else "переменная проекта GitLab, дочерний пайплайн её из триггера не видит"
        )
        print(f"ERROR: не задана переменная {name} ({hint})", file=sys.stderr)
        raise SystemExit(EXIT_ENVIRONMENT)
    return value


def minutes(seconds: int) -> str:
    return q(f"{max(10, -(-int(seconds) // 60))}m")


def vault_job_lines(secrets: list) -> list[str]:
    """Блок GitLab, который резолвит секреты до старта скрипта. Значений здесь нет — только пути."""
    if not secrets:
        return []
    url = require_env("LT_VAULT_SERVER_URL")
    if not re.fullmatch(r"https://[A-Za-z0-9._:-]{1,200}", url):
        print(f"ERROR: LT_VAULT_SERVER_URL='{url}' — ожидается https://хост[:порт]", file=sys.stderr)
        raise SystemExit(EXIT_ENVIRONMENT)
    role = os.environ.get("LT_VAULT_AUTH_ROLE", "lt-ci").strip() or "lt-ci"
    auth_path = os.environ.get("LT_VAULT_AUTH_PATH", "jwt").strip() or "jwt"
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,64}", role) or not re.fullmatch(r"[A-Za-z0-9._/-]{1,64}", auth_path):
        print("ERROR: LT_VAULT_AUTH_ROLE или LT_VAULT_AUTH_PATH содержит недопустимые символы", file=sys.stderr)
        raise SystemExit(EXIT_ENVIRONMENT)

    lines = [
        # Runner читает эти имена, когда исполняет ключ secrets:.
        f"    VAULT_SERVER_URL: {q(url)}",
        f"    VAULT_AUTH_ROLE: {q(role)}",
        f"    VAULT_AUTH_PATH: {q(auth_path)}",
        "  id_tokens:",
        "    LT_VAULT_ID_TOKEN:",
        f"      aud: {q(url)}",
        "  secrets:",
    ]
    for item in secrets:
        lines += [
            f"    LT_SECRET_{item['name']}:",
            f"      vault: {q(item['vault'])}",
            "      file: false",
            "      token: $LT_VAULT_ID_TOKEN",
        ]
    return lines


def generator_job(name: str, mode: str, image: str, tag: str, resources: dict, timeout_sec: int,
                  shards: int, needs_smoke: bool, secrets: list | None = None) -> list[str]:
    lines = [
        f"{name}:",
        f"  stage: {name}",
        f"  image: {q(image)}",
        f"  tags: [{q(tag)}]",
    ]
    # parallel допускает значения 2..200; для одного шарда ключ опускается.
    if shards > 1:
        lines.append(f"  parallel: {shards}")
    lines += [f"  timeout: {minutes(timeout_sec)}", "  needs:", *PRE_CHECK_NEED]
    if needs_smoke:
        lines += ["    - job: smoke-check", "      artifacts: false"]
    lines += [
        "  variables:",
        # Сценарий и манифест приходят артефактом pre-check: клонировать репозиторий незачем.
        "    GIT_STRATEGY: none",
        f"    LT_MODE: {q(mode)}",
        # requests == limits у build-контейнера; helper выравнивается в config.toml runner'а.
        f"    KUBERNETES_CPU_REQUEST: {q(resources['cpu'])}",
        f"    KUBERNETES_CPU_LIMIT: {q(resources['cpu'])}",
        f"    KUBERNETES_MEMORY_REQUEST: {q(resources['memory'])}",
        f"    KUBERNETES_MEMORY_LIMIT: {q(resources['memory'])}",
        # Без этого флага ENTRYPOINT образа (tini -g) игнорируется, и при отмене
        # инструмент получает SIGKILL, не успев сбросить результаты.
        '    FF_KUBERNETES_HONOR_ENTRYPOINT: "true"',
        *vault_job_lines(secrets or []),
        "  script:",
        "    - lt-run",
        "  artifacts:",
        "    when: always",
        "    expire_in: 30 days",
        "    paths: [results/]",
        "",
    ]
    return lines


def render(manifest: dict) -> str:
    computed = manifest["computed"]
    tool = manifest["run"]["tool"]
    smoke_only = manifest["run"].get("profile") == "smoke"
    smoke = computed.get("smoke", {"enabled": False})
    shards = int(computed["shards"])
    resources = computed["resources"]

    generator_image = require_env(TOOL_IMAGE_VARS[tool])
    tools_image = require_env("LT_IMAGE_CI_TOOLS")
    generator_tag = os.environ.get("LT_GENERATOR_TAG", "lt-generators")
    control_tag = os.environ.get("LT_CONTROL_TAG", "lt-control")
    secrets = manifest.get("secrets") or []

    stages = (["smoke"] if smoke["enabled"] else []) + ([] if smoke_only else ["generate"]) + ["gate", "publish"]
    lines = [
        f"# Сгенерировано ci/lib/child_pipeline.py для прогона {computed['run_label']}. Не редактировать.",
        f"stages: [{', '.join(stages)}]",
        "",
        "default:",
        "  interruptible: false",
        "  retry: 0",
        "",
    ]
    if smoke["enabled"]:
        lines += generator_job("smoke", "smoke", generator_image, generator_tag, resources,
                               smoke["budget_sec"] + 300, 1, False, secrets)
    if smoke["enabled"] and not smoke_only:
        # lt-run выходит с 0 при любых итогах, поэтому годность smoke решает отдельная
        # джоба тем же verdict.py: generate стартует только после неё.
        lines += [
            "smoke-check:",
            "  stage: smoke",
            f"  image: {q(tools_image)}",
            f"  tags: [{q(control_tag)}]",
            "  needs:",
            *PRE_CHECK_NEED,
            "    - job: smoke",
            "      artifacts: true",
            "  script:",
            "    - python3 ci/lib/verdict.py --manifest .nt/run.json --results results --stage smoke",
            "  artifacts:",
            "    when: always",
            "    expire_in: 30 days",
            "    paths: [results/smoke/verdict.json]",
            "",
        ]
    if not smoke_only:
        lines += generator_job("generate", "load", generator_image, generator_tag, resources,
                               computed["schedule"]["job_timeout_sec"], shards, smoke["enabled"], secrets)

    lines += [
        "gate:",
        "  stage: gate",
        f"  image: {q(tools_image)}",
        f"  tags: [{q(control_tag)}]",
        # Вердикт нужен и тогда, когда smoke или генератор упали: это отличает
        # «прогон не состоялся» от «SLA нарушен».
        "  when: always",
        "  needs:",
        *PRE_CHECK_NEED,
    ]
    for job in ([] if not smoke["enabled"] else ["smoke"]) + ([] if smoke_only else ["generate"]):
        lines += [f"    - job: {job}", "      artifacts: true"]
    lines += [
        "  script:",
        "    - python3 ci/lib/verdict.py --manifest .nt/run.json --results results",
        "  artifacts:",
        "    when: always",
        "    expire_in: 30 days",
        "    paths: [results/verdict.json, results/junit.xml]",
        "    reports:",
        "      junit: results/junit.xml",
        "",
        # allow_failure: недоступный портал не превращает пройденный SLA в красный пайплайн.
        # when: always — вердикт уходит и после провала gate (там как раз failed/invalid).
        "publish:",
        "  stage: publish",
        f"  image: {q(tools_image)}",
        f"  tags: [{q(control_tag)}]",
        "  when: always",
        "  allow_failure: true",
        "  needs:",
        "    - job: gate",
        "      artifacts: true",
        "  script:",
        "    - python3 ci/lib/publish.py",
    ]
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Генерация дочернего пайплайна прогона")
    parser.add_argument("--manifest", default=".nt/run.json")
    parser.add_argument("--out", default=".nt/child.yml")
    args = parser.parse_args()

    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    Path(args.out).write_text(render(manifest), encoding="utf-8")
    computed = manifest["computed"]
    smoke = "со smoke" if computed.get("smoke", {}).get("enabled") else "без smoke"
    print(f"INFO: дочерний пайплайн: {args.out} ({computed['shards']} шард(ов), {smoke})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
