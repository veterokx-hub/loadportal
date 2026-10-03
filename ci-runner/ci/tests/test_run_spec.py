import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))

import run_spec  # noqa: E402

ENV = {"LT_SMOKE_BUDGET_SEC": "300", "LT_SHARD_START_GRACE_SEC": "120", "LT_MAX_START_LAG_SEC": "900"}


def spec(profile: str = "load", smoke: str | None = None, schedule_in_sec: int | None = None) -> dict:
    run = {"tool": "k6", "profile": profile}
    if smoke:
        run["smoke"] = smoke
    result = {"run": run, "load": {"duration_sec": 600}}
    if schedule_in_sec is not None:
        start = datetime.now(timezone.utc) + timedelta(seconds=schedule_in_sec)
        result["schedule"] = {
            "start": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "end": (start + timedelta(seconds=600)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
    return result


@mock.patch.dict(os.environ, ENV)
class SmokeResolutionTest(unittest.TestCase):
    def test_auto_by_profile(self):
        self.assertTrue(run_spec.resolve_smoke(spec("load"))["enabled"])
        self.assertTrue(run_spec.resolve_smoke(spec("max-search"))["enabled"])
        self.assertFalse(run_spec.resolve_smoke(spec("qg"))["enabled"])
        self.assertTrue(run_spec.resolve_smoke(spec("qg", "always"))["enabled"])
        self.assertFalse(run_spec.resolve_smoke(spec("load", "never"))["enabled"])
        self.assertTrue(run_spec.resolve_smoke(spec("smoke", "never"))["enabled"])

    def test_immediate_window_shifted_by_smoke(self):
        s = spec("load")
        window = run_spec.resolve_window(s, 2, run_spec.resolve_smoke(s))
        self.assertGreaterEqual(window["start_lag_sec"], 300 + 120 - 2)

    def test_tight_schedule_skips_auto_smoke(self):
        s = spec("load", schedule_in_sec=60)
        smoke = run_spec.resolve_smoke(s)
        run_spec.resolve_window(s, 1, smoke)
        self.assertFalse(smoke["enabled"])

    def test_tight_schedule_rejects_always_smoke(self):
        s = spec("load", "always", schedule_in_sec=60)
        with self.assertRaises(SystemExit) as ctx:
            run_spec.resolve_window(s, 1, run_spec.resolve_smoke(s))
        self.assertEqual(ctx.exception.code, run_spec.EXIT_CONTRACT)

    def test_smoke_profile_window(self):
        s = spec("smoke")
        window = run_spec.resolve_window(s, 1, run_spec.resolve_smoke(s))
        self.assertEqual(window["duration_sec"], 60)
        self.assertEqual(window["start_lag_sec"], 0)


class QgAndSecretsTest(unittest.TestCase):
    def test_flat_qg_variables(self):
        env = {
            "LT_QG": "1",
            "TOOL": "k6",
            "SCENARIO_PATH": "scenarios/payments-api/qg.js",
            "REPOSITORY": "Payments-API",
            "BASE_URL": "https://payments.test.corp.local",
            "SLA_P95_MS": "300",
            "SLA_ERROR_RATE_PCT": "1.5",
            "SOURCE_PROJECT": "fintech/payments-api",
            "SOURCE_COMMIT": "a" * 40,
            "LT_QG_SECRETS": "TOKEN=loadtest/payments/TOKEN@kv",
        }
        with mock.patch.dict(os.environ, env, clear=True):
            built = run_spec.legacy_spec()
        self.assertEqual(built["run"]["trigger"], "dev-pipeline")
        self.assertEqual(built["run"]["profile"], "qg")
        self.assertEqual(built["run"]["smoke"], "never")
        self.assertEqual(built["target"]["repository"], "payments-api")
        self.assertEqual(built["target"]["environment"], "test")
        self.assertEqual(built["sla"], {"p95_ms": 300, "error_rate_pct": 1.5})
        self.assertEqual(built["load"]["duration_sec"], 600)
        self.assertEqual(built["resources"]["replicas"], 1)
        self.assertEqual(built["resources"]["cpu"], "1")
        self.assertEqual(built["secrets"][0]["name"], "TOKEN")
        self.assertEqual(built["meta"]["source_commit"], "a" * 40)

    def test_qg_without_sla_is_contract_error(self):
        env = {"LT_QG": "1", "TOOL": "k6", "SCENARIO_PATH": "scenarios/a.js", "REPOSITORY": "payments"}
        with mock.patch.dict(os.environ, env, clear=True):
            with self.assertRaises(SystemExit) as ctx:
                run_spec.legacy_spec()
        self.assertEqual(ctx.exception.code, run_spec.EXIT_CONTRACT)

    def test_qg_rejects_replicas(self):
        env = {
            "LT_QG": "1", "TOOL": "k6", "SCENARIO_PATH": "scenarios/a.js", "REPOSITORY": "payments",
            "SLA_P95_MS": "300", "REPLICAS": "2",
        }
        with mock.patch.dict(os.environ, env, clear=True):
            with self.assertRaises(SystemExit) as ctx:
                run_spec.legacy_spec()
        self.assertEqual(ctx.exception.code, run_spec.EXIT_CONTRACT)

    def test_duplicate_secret_name(self):
        with self.assertRaises(SystemExit):
            run_spec.check_secrets({"secrets": [
                {"name": "TOKEN", "vault": "a/TOKEN@kv"},
                {"name": "TOKEN", "vault": "b/TOKEN@kv"},
            ]})

    def test_vault_url_required_only_when_secrets_present(self):
        run_spec.require_vault({})
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(SystemExit) as ctx:
                run_spec.require_vault({"secrets": [{"name": "TOKEN"}]})
        self.assertEqual(ctx.exception.code, run_spec.EXIT_ENVIRONMENT)


if __name__ == "__main__":
    unittest.main()
