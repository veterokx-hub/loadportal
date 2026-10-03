#!/usr/bin/env python3
"""Отправка results/verdict.json в портал после gate.

LT_PORTAL_CALLBACK_URL — полный адрес, например
https://portal.example/api/runs/webhook/verdict.
Пустой URL — ручной прогон без портала, джоба заканчивается успехом.
LT_PORTAL_CALLBACK_TOKEN — тот же секрет, что заголовок X-Gitlab-Token вебхука.
Переменные задаются на проекте GitLab: дочерний пайплайн не видит переменные триггера.
Токен в лог не пишется. Сбой доставки не должен подменять вердикт gate:
джоба publish в child.yml помечена allow_failure.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

TIMEOUT_SEC = 20


def post_verdict(path: Path, url: str, token: str) -> int:
    if not url:
        print("WARN: LT_PORTAL_CALLBACK_URL пуст — вердикт остаётся в артефактах", file=sys.stderr)
        return 0
    if not token:
        print("ERROR: задан LT_PORTAL_CALLBACK_URL, но нет LT_PORTAL_CALLBACK_TOKEN", file=sys.stderr)
        return 1
    if not path.is_file():
        print(f"ERROR: нет файла вердикта {path}", file=sys.stderr)
        return 1

    body = path.read_bytes()
    # Ловим битый JSON до сети: портал ответит 400, а в логе джобы причина будет яснее.
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError as exc:
        print(f"ERROR: {path} не JSON: {exc}", file=sys.stderr)
        return 1
    if not parsed.get("portal_run_id") or not parsed.get("status"):
        print("ERROR: в вердикте нет portal_run_id или status", file=sys.stderr)
        return 1

    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "X-Gitlab-Token": token},
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SEC) as response:
            code = response.status
    except urllib.error.HTTPError as exc:
        print(f"ERROR: портал ответил {exc.code} на доставку вердикта", file=sys.stderr)
        return 1
    except urllib.error.URLError as exc:
        print(f"ERROR: портал недоступен: {exc.reason}", file=sys.stderr)
        return 1
    print(f"INFO: вердикт {parsed['status']} доставлен, HTTP {code}")
    return 0


def main() -> int:
    url = os.environ.get("LT_PORTAL_CALLBACK_URL", "").strip()
    token = os.environ.get("LT_PORTAL_CALLBACK_TOKEN", "").strip()
    path = Path(os.environ.get("LT_VERDICT_PATH", "results/verdict.json"))
    return post_verdict(path, url, token)


if __name__ == "__main__":
    sys.exit(main())
