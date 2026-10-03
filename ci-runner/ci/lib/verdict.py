#!/usr/bin/env python3
"""Единый вердикт прогона по результатам всех шардов.

Вход:  .nt/run.json и results/shard-<N>/ (meta.json + сырые итоги инструмента).
Выход: results/verdict.json (для портала) и results/junit.xml (для MR-виджета).

Статусы по убыванию приоритета:
  invalid — прогон не дал достоверных данных (шард не стартовал, инструмент упал,
            метрику SLA нечем проверить). Повторить прогон.
  failed  — данные достоверны, SLA нарушен.
  passed  — данные достоверны, SLA выполнен.

Перцентили: JMeter — точные по объединённым JTL всех шардов. k6 и Gatling отдают
только готовые перцентили на шард; при N > 1 берётся максимум по шардам —
оценка сверху (exact=false), для QG это безопасное направление ошибки.

Smoke (results/smoke/): инструмент отработал без ошибок, ошибок не больше порога,
каждый запрос выполнен хотя бы раз. Покрытие проверяется по JMX для JMeter; k6 и
Gatling сообщают о нём сами — порогами count>0 и assertions, то есть кодом выхода.
Проваленный smoke перед нагрузкой — invalid (нагрузка не подавалась), при profile=smoke — failed.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter
from pathlib import Path
from xml.sax.saxutils import escape, quoteattr

PASSED, FAILED, INVALID = "passed", "failed", "invalid"
EXIT_BY_STATUS = {PASSED: 0, FAILED: 1, INVALID: 2}

# Коды выхода инструментов, означающие «данные есть, но нарушен порог».
THRESHOLD_EXIT = {"jmeter": {3}, "k6": {99}, "gatling": set()}


def percentile(hist: Counter, total: int, pct: float) -> float | None:
    """Nearest-rank по гистограмме миллисекунд: точно и без списка всех сэмплов."""
    if total == 0:
        return None
    rank = max(1, -(-int(total * pct) // 100))
    seen = 0
    for value in sorted(hist):
        seen += hist[value]
        if seen >= rank:
            return float(value)
    return None


def read_jtl(path: Path, hist: Counter, labels: set | None = None) -> dict:
    total = errors = 0
    first_ts = last_ts = None
    with path.open(newline="", encoding="utf-8", errors="replace") as handle:
        for row in csv.DictReader(handle):
            try:
                elapsed = int(row["elapsed"])
                started = int(row["timeStamp"])
            except (KeyError, TypeError, ValueError):
                continue
            if labels is not None:
                labels.add(row.get("label", ""))
            hist[elapsed] += 1
            total += 1
            if row.get("success", "").strip().lower() != "true":
                errors += 1
            finished = started + elapsed
            first_ts = started if first_ts is None else min(first_ts, started)
            last_ts = finished if last_ts is None else max(last_ts, finished)
    return {"samples": total, "errors": errors, "first_ts": first_ts, "last_ts": last_ts}


def aggregate_jmeter(shard_dirs: list[Path], labels: set | None = None) -> dict:
    hist: Counter = Counter()
    total = errors = 0
    first_ts = last_ts = None
    for shard_dir in shard_dirs:
        jtl = shard_dir / "kpi.jtl"
        if not jtl.is_file():
            continue
        part = read_jtl(jtl, hist, labels)
        total += part["samples"]
        errors += part["errors"]
        if part["first_ts"] is not None:
            first_ts = part["first_ts"] if first_ts is None else min(first_ts, part["first_ts"])
            last_ts = part["last_ts"] if last_ts is None else max(last_ts, part["last_ts"])
    span = (last_ts - first_ts) / 1000 if total and last_ts > first_ts else None
    return {
        "samples": total,
        "p95_ms": percentile(hist, total, 95),
        "p99_ms": percentile(hist, total, 99),
        "error_rate_pct": 100.0 * errors / total if total else None,
        "rps": total / span if span else None,
        "exact": True,
    }


def combine_shards(parts: list[dict]) -> dict:
    """Сведение готовых итогов шардов: суммы и средневзвешенное точно, перцентили — максимум."""
    parts = [part for part in parts if part["samples"]]
    total = sum(part["samples"] for part in parts)

    def worst(key: str) -> float | None:
        values = [part[key] for part in parts]
        return max(values) if values and None not in values else None

    return {
        "samples": total,
        "p95_ms": worst("p95_ms"),
        "p99_ms": worst("p99_ms"),
        "error_rate_pct": sum(part["errors"] for part in parts) * 100.0 / total if total else None,
        "rps": sum(part["rps"] for part in parts) if parts else None,
        "exact": len(parts) <= 1,
    }


def read_k6(shard_dir: Path) -> dict | None:
    path = shard_dir / "summary.json"
    if not path.is_file():
        return None
    metrics = json.loads(path.read_text(encoding="utf-8")).get("metrics", {})
    duration = metrics.get("http_req_duration", {})
    reqs = metrics.get("http_reqs", {})
    samples = int(reqs.get("count") or 0)
    failed_rate = float(metrics.get("http_req_failed", {}).get("value") or 0.0)
    return {
        "samples": samples,
        "errors": failed_rate * samples,
        "p95_ms": duration.get("p(95)"),
        "p99_ms": duration.get("p(99)"),
        "rps": float(reqs.get("rate") or 0.0),
    }


def read_gatling(shard_dir: Path) -> dict | None:
    path = shard_dir / "global_stats.json"
    if not path.is_file():
        return None
    stats = json.loads(path.read_text(encoding="utf-8"))
    requests = stats.get("numberOfRequests", {})
    # Индикаторы по умолчанию gatling.conf: percentile3 = 95, percentile4 = 99.
    return {
        "samples": int(requests.get("total") or 0),
        "errors": int(requests.get("ko") or 0),
        "p95_ms": stats.get("percentiles3", {}).get("total"),
        "p99_ms": stats.get("percentiles4", {}).get("total"),
        "rps": float(stats.get("meanNumberOfRequestsPerSecond", {}).get("total") or 0.0),
    }


def has_results(tool: str, shard_dir: Path) -> bool:
    name = {"jmeter": "kpi.jtl", "k6": "summary.json", "gatling": "global_stats.json"}[tool]
    return (shard_dir / name).is_file()


def judge_shard(tool: str, index: int, shard_dir: Path) -> dict:
    meta_path = shard_dir / "meta.json"
    if not meta_path.is_file():
        return {"shard": index, "status": INVALID, "reason": "шард не вернул meta.json — pod не стартовал или был убит"}
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    code = meta.get("tool_exit_code")

    if meta.get("error"):
        return {"shard": index, "status": INVALID, "reason": meta["error"], "exit_code": code}
    if not has_results(tool, shard_dir):
        return {"shard": index, "status": INVALID, "reason": f"{tool} завершился с кодом {code} без итогов", "exit_code": code}
    if code == 0:
        return {"shard": index, "status": PASSED, "exit_code": code}
    # Gatling рвёт прогон ненулевым кодом и по assertions, и по AutoStop — итоги при этом есть.
    if code in THRESHOLD_EXIT[tool] or tool == "gatling":
        return {"shard": index, "status": FAILED, "reason": f"{tool} сообщил о нарушении порога (код {code})", "exit_code": code}
    return {"shard": index, "status": INVALID, "reason": f"{tool} завершился с кодом {code}", "exit_code": code}


def evaluate_sla(sla: dict, metrics: dict) -> list[dict]:
    checks = []
    rules = [
        ("p95_ms", "p95_ms", "<="),
        ("p99_ms", "p99_ms", "<="),
        ("error_rate_pct", "error_rate_pct", "<="),
        ("min_rps", "rps", ">="),
    ]
    for sla_key, metric_key, op in rules:
        if sla.get(sla_key) is None:
            continue
        limit = float(sla[sla_key])
        actual = metrics.get(metric_key)
        if actual is None:
            status = INVALID
        elif op == "<=":
            status = PASSED if actual <= limit else FAILED
        else:
            status = PASSED if actual >= limit else FAILED
        checks.append({"name": sla_key, "op": op, "limit": limit, "actual": actual, "status": status})
    return checks


def worst_status(statuses: list[str]) -> str:
    for status in (INVALID, FAILED):
        if status in statuses:
            return status
    return PASSED


def collect_metrics(tool: str, dirs: list[Path], labels: set | None = None) -> dict:
    if tool == "jmeter":
        return aggregate_jmeter(dirs, labels)
    reader = read_k6 if tool == "k6" else read_gatling
    return combine_shards([part for part in (reader(path) for path in dirs) if part])


def jmx_bytes(scenario_path: Path, entrypoint: str) -> bytes | None:
    if scenario_path.suffix != ".zip":
        return scenario_path.read_bytes() if scenario_path.is_file() else None
    with zipfile.ZipFile(scenario_path) as archive:
        names = [name for name in archive.namelist() if name.endswith(".jmx") and name.count("/") <= 1]
        name = entrypoint or (names[0] if len(names) == 1 else None)
        return archive.read(name) if name in archive.namelist() else None


def expected_jmeter_labels(jmx: bytes) -> set[str]:
    """Метки, которые обязан дать JMX: включённые HTTP-сэмплеры, вне выключенных веток.

    Transaction Controller с «Generate parent sample» пишет в JTL только себя.
    Имена с ${...} вычисляются в рантайме — их проверить нельзя, они пропускаются.
    """
    labels: set[str] = set()

    def walk(tree: ET.Element) -> None:
        children = list(tree)
        index = 0
        while index < len(children):
            element = children[index]
            subtree = None
            if index + 1 < len(children) and children[index + 1].tag == "hashTree":
                subtree = children[index + 1]
                index += 1
            index += 1
            if element.get("enabled", "true") == "false":
                continue
            name = element.get("testname", "")
            is_parent_tc = element.tag == "TransactionController" and any(
                prop.get("name") == "TransactionController.parent" and (prop.text or "").strip() == "true"
                for prop in element.iter("boolProp")
            )
            if element.tag == "HTTPSamplerProxy" or is_parent_tc:
                if name and "${" not in name:
                    labels.add(name)
                if is_parent_tc:
                    continue
            if subtree is not None:
                walk(subtree)

    root = ET.fromstring(jmx)
    top = root.find("hashTree")
    if top is not None:
        walk(top)
    return labels


def judge_smoke(manifest: dict, results_dir: Path) -> dict:
    tool = manifest["run"]["tool"]
    computed = manifest["computed"]
    smoke_dir = results_dir / "smoke"
    problems = []

    shard = judge_shard(tool, 0, smoke_dir)
    if shard["status"] != PASSED:
        problems.append(shard["reason"])

    seen: set[str] = set()
    metrics = collect_metrics(tool, [smoke_dir], seen)
    limit = float(computed["smoke"].get("max_error_pct", 0))
    if not metrics["samples"]:
        problems.append("ни одного сэмпла")
    elif metrics["error_rate_pct"] is not None and metrics["error_rate_pct"] > limit:
        problems.append(f"ошибок {metrics['error_rate_pct']:.2f}% при допустимых {limit}%")

    missing: list[str] = []
    if tool == "jmeter":
        jmx = jmx_bytes(Path(computed["scenario"]["local_path"]), manifest["scenario"].get("entrypoint", ""))
        if jmx is None:
            problems.append("не найден JMX для проверки покрытия")
        else:
            missing = sorted(expected_jmeter_labels(jmx) - seen)
            if missing:
                shown = ", ".join(missing[:10]) + (f" и ещё {len(missing) - 10}" if len(missing) > 10 else "")
                problems.append(f"не выполнены запросы: {shown}")

    return {
        "status": FAILED if problems else PASSED,
        "problems": problems,
        "missing_labels": missing,
        "metrics": metrics,
        "exit_code": shard.get("exit_code"),
    }


def build_verdict(manifest: dict, results_dir: Path) -> dict:
    tool = manifest["run"]["tool"]
    computed = manifest["computed"]
    shards = int(computed["shards"])
    base = {
        "tool": tool,
        "portal_run_id": manifest["run"].get("portal_run_id"),
        "run_label": computed["run_label"],
        "shards": shards,
    }

    smoke = judge_smoke(manifest, results_dir) if computed.get("smoke", {}).get("enabled") else None
    smoke_only = manifest["run"].get("profile") == "smoke"
    if smoke and (smoke_only or smoke["status"] != PASSED):
        return {
            **base,
            # Smoke перед нагрузкой провален — нагрузки не было, судить SLA не по чему.
            "status": smoke["status"] if smoke_only else INVALID,
            "metrics": smoke["metrics"],
            "checks": [],
            "shard_results": [],
            "smoke": smoke,
            "reasons": [f"smoke: {problem}" for problem in smoke["problems"]],
        }

    shard_dirs = [results_dir / f"shard-{index}" for index in range(1, shards + 1)]
    shard_results = [judge_shard(tool, index, path) for index, path in enumerate(shard_dirs, start=1)]
    metrics = collect_metrics(tool, shard_dirs)

    checks = evaluate_sla(manifest.get("sla") or {}, metrics)
    reasons = [f"shard-{item['shard']}: {item['reason']}" for item in shard_results if item["status"] != PASSED]
    reasons += [
        f"{check['name']}: {check['actual']} {check['op']} {check['limit']} не выполнено"
        if check["status"] == FAILED
        else f"{check['name']}: метрика недоступна"
        for check in checks
        if check["status"] != PASSED
    ]
    if not metrics["samples"]:
        reasons.append("ни одного сэмпла: нагрузка не подавалась")

    status = worst_status(
        [item["status"] for item in shard_results]
        + [check["status"] for check in checks]
        + ([INVALID] if not metrics["samples"] else [])
    )
    return {
        **base,
        "status": status,
        "metrics": metrics,
        "checks": checks,
        "shard_results": shard_results,
        "smoke": smoke,
        "reasons": reasons,
    }


def junit(verdict: dict) -> str:
    cases = []
    smoke = verdict.get("smoke")
    if smoke:
        cases.append(("smoke", smoke["status"], "; ".join(smoke["problems"])))
    for item in verdict["shard_results"]:
        cases.append((f"shard-{item['shard']}", item["status"], item.get("reason", "")))
    for check in verdict["checks"]:
        detail = f"actual={check['actual']} {check['op']} limit={check['limit']}"
        cases.append((f"sla.{check['name']}", check["status"], detail))
    if not verdict["metrics"]["samples"]:
        cases.append(("samples", INVALID, "ни одного сэмпла"))

    failures = sum(1 for _, status, _ in cases if status == FAILED)
    errors = sum(1 for _, status, _ in cases if status == INVALID)
    suite = f"load-test {verdict['tool']} {verdict['run_label']}"
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f"<testsuites><testsuite name={quoteattr(suite)} tests=\"{len(cases)}\" failures=\"{failures}\" errors=\"{errors}\">",
    ]
    for name, status, detail in cases:
        lines.append(f"  <testcase classname={quoteattr(suite)} name={quoteattr(name)}>")
        if status == FAILED:
            lines.append(f"    <failure message={quoteattr(detail)}>{escape(detail)}</failure>")
        elif status == INVALID:
            lines.append(f"    <error message={quoteattr(detail)}>{escape(detail)}</error>")
        lines.append("  </testcase>")
    lines.append("</testsuite></testsuites>")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Сводный вердикт прогона")
    parser.add_argument("--manifest", default=".nt/run.json")
    parser.add_argument("--results", default="results")
    parser.add_argument("--stage", choices=["gate", "smoke"], default="gate",
                        help="smoke — только оценка smoke: ненулевой код не пускает generate")
    args = parser.parse_args()

    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    results_dir = Path(args.results)
    results_dir.mkdir(parents=True, exist_ok=True)

    if args.stage == "smoke":
        smoke = judge_smoke(manifest, results_dir)
        (results_dir / "smoke").mkdir(exist_ok=True)
        (results_dir / "smoke" / "verdict.json").write_text(json.dumps(smoke, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"SMOKE: {smoke['status'].upper()}  сэмплов={smoke['metrics']['samples']} ошибок%={smoke['metrics']['error_rate_pct']}")
        for problem in smoke["problems"]:
            print(f"  - {problem}")
        return EXIT_BY_STATUS[smoke["status"]]

    verdict = build_verdict(manifest, results_dir)
    (results_dir / "verdict.json").write_text(json.dumps(verdict, ensure_ascii=False, indent=2), encoding="utf-8")
    (results_dir / "junit.xml").write_text(junit(verdict), encoding="utf-8")

    metrics = verdict["metrics"]
    print(
        f"ВЕРДИКТ: {verdict['status'].upper()}  сэмплов={metrics['samples']} "
        f"p95={metrics['p95_ms']} p99={metrics['p99_ms']} ошибок%={metrics['error_rate_pct']} "
        f"rps={metrics['rps']} точные_перцентили={metrics['exact']}"
    )
    for reason in verdict["reasons"]:
        print(f"  - {reason}")
    return EXIT_BY_STATUS[verdict["status"]]


if __name__ == "__main__":
    sys.exit(main())
