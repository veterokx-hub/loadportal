import json
import sys
import tempfile
import unittest
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))

import verdict  # noqa: E402

JTL_HEADER = "timeStamp,elapsed,label,responseCode,success\n"


JMX = b"""<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2"><hashTree>
  <TestPlan testname="plan"/><hashTree>
    <ThreadGroup testname="g0"/><hashTree>
      <HTTPSamplerProxy testname="login"/><hashTree/>
      <HTTPSamplerProxy testname="search"/><hashTree/>
      <HTTPSamplerProxy testname="off" enabled="false"/><hashTree/>
      <HTTPSamplerProxy testname="item ${id}"/><hashTree/>
      <TransactionController testname="checkout">
        <boolProp name="TransactionController.parent">true</boolProp>
      </TransactionController><hashTree>
        <HTTPSamplerProxy testname="pay"/><hashTree/>
      </hashTree>
      <IfController testname="disabled branch" enabled="false"/><hashTree>
        <HTTPSamplerProxy testname="hidden"/><hashTree/>
      </hashTree>
    </hashTree>
  </hashTree>
</hashTree></jmeterTestPlan>
"""


def manifest(tool: str, shards: int = 1, sla: dict | None = None, profile: str = "load",
             smoke: bool = False, local_path: str = "") -> dict:
    return {
        "run": {"tool": tool, "profile": profile, "portal_run_id": "11111111-1111-4111-8111-111111111111"},
        "scenario": {},
        "sla": sla or {},
        "computed": {
            "shards": shards,
            "run_label": "nt-1-11111111",
            "smoke": {"enabled": smoke, "max_error_pct": 0},
            "scenario": {"local_path": local_path},
        },
    }


class VerdictTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.results = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def shard(self, index: int | str, exit_code: int = 0, **files: str) -> Path:
        path = self.results / (index if isinstance(index, str) else f"shard-{index}")
        path.mkdir(parents=True, exist_ok=True)
        (path / "meta.json").write_text(json.dumps({"shard": index, "tool_exit_code": exit_code}))
        for name, content in files.items():
            stem, _, ext = name.rpartition("_")
            (path / f"{stem}.{ext}").write_text(content)
        return path

    @staticmethod
    def jtl(rows: list[tuple[int, int, bool]], label: str = "req") -> str:
        return JTL_HEADER + "".join(f"{ts},{el},{label},200,{str(ok).lower()}\n" for ts, el, ok in rows)

    @staticmethod
    def labelled_jtl(labels: list[str], ok: bool = True) -> str:
        return JTL_HEADER + "".join(f"{1000 + i},50,{name},200,{str(ok).lower()}\n" for i, name in enumerate(labels))

    def jmx_path(self) -> str:
        path = self.results / "scenario.jmx"
        path.write_bytes(JMX)
        return str(path)

    def test_expected_jmeter_labels(self):
        # Выключенные ветки пропущены, parent TC заменяет детей, ${...} не проверяется.
        self.assertEqual(verdict.expected_jmeter_labels(JMX), {"login", "search", "checkout"})

    def test_smoke_passed_then_load_evaluated(self):
        self.shard("smoke", kpi_jtl=self.labelled_jtl(["login", "search", "checkout"]))
        self.shard(1, kpi_jtl=self.jtl([(1000, 100, True)]))
        result = verdict.build_verdict(
            manifest("jmeter", sla={"p95_ms": 500}, smoke=True, local_path=self.jmx_path()), self.results)
        self.assertEqual(result["smoke"]["status"], verdict.PASSED)
        self.assertEqual(result["status"], verdict.PASSED)
        self.assertIn('name="smoke"', verdict.junit(result))

    def test_smoke_missing_request_blocks_load(self):
        self.shard("smoke", kpi_jtl=self.labelled_jtl(["login"]))
        result = verdict.build_verdict(manifest("jmeter", smoke=True, local_path=self.jmx_path()), self.results)
        self.assertEqual(result["status"], verdict.INVALID)
        self.assertEqual(result["smoke"]["missing_labels"], ["checkout", "search"])
        self.assertIn("не выполнены запросы", result["reasons"][0])

    def test_smoke_errors_fail(self):
        self.shard("smoke", kpi_jtl=self.labelled_jtl(["login", "search", "checkout"], ok=False))
        smoke = verdict.judge_smoke(manifest("jmeter", smoke=True, local_path=self.jmx_path()), self.results)
        self.assertEqual(smoke["status"], verdict.FAILED)

    def test_smoke_profile_verdict(self):
        self.shard("smoke", exit_code=99, summary_json=json.dumps({"metrics": {
            "http_req_duration": {"p(95)": 100}, "http_reqs": {"count": 4, "rate": 1}, "http_req_failed": {"value": 0},
        }}))
        result = verdict.build_verdict(manifest("k6", profile="smoke", smoke=True), self.results)
        # profile=smoke: провал smoke — это и есть вердикт прогона, а не «нагрузки не было».
        self.assertEqual(result["status"], verdict.FAILED)

    def test_percentile_nearest_rank(self):
        hist = Counter(range(1, 101))
        self.assertEqual(verdict.percentile(hist, 100, 95), 95.0)
        self.assertEqual(verdict.percentile(hist, 100, 99), 99.0)
        self.assertIsNone(verdict.percentile(Counter(), 0, 95))

    def test_jmeter_shards_merge_exact(self):
        # Шард 1 быстрый, шард 2 медленный: точный p95 по объединению, а не максимум по шардам.
        self.shard(1, kpi_jtl=self.jtl([(1000 + i, 100, True) for i in range(90)]))
        self.shard(2, kpi_jtl=self.jtl([(1000 + i, 900, i != 0) for i in range(10)]))
        result = verdict.build_verdict(manifest("jmeter", 2, {"p95_ms": 1000, "error_rate_pct": 2}), self.results)
        self.assertEqual(result["metrics"]["samples"], 100)
        self.assertEqual(result["metrics"]["p95_ms"], 900.0)
        self.assertAlmostEqual(result["metrics"]["error_rate_pct"], 1.0)
        self.assertTrue(result["metrics"]["exact"])
        self.assertEqual(result["status"], verdict.PASSED)

    def test_jmeter_passfail_exit_is_failed(self):
        self.shard(1, exit_code=3, kpi_jtl=self.jtl([(1000, 700, True)]))
        result = verdict.build_verdict(manifest("jmeter", sla={"p95_ms": 500}), self.results)
        self.assertEqual(result["status"], verdict.FAILED)

    def test_missing_shard_is_invalid(self):
        self.shard(1, kpi_jtl=self.jtl([(1000, 100, True)]))
        result = verdict.build_verdict(manifest("jmeter", 2), self.results)
        self.assertEqual(result["status"], verdict.INVALID)
        self.assertIn("shard-2", result["reasons"][0])

    def test_invalid_beats_failed(self):
        self.shard(1, exit_code=1, kpi_jtl=self.jtl([(1000, 5000, False)]))
        result = verdict.build_verdict(manifest("jmeter", sla={"p95_ms": 500}), self.results)
        self.assertEqual(result["status"], verdict.INVALID)

    def test_k6_threshold_exit_and_conservative_combine(self):
        summary = lambda p95, rate: json.dumps({"metrics": {  # noqa: E731
            "http_req_duration": {"p(95)": p95, "p(99)": p95 * 2},
            "http_reqs": {"count": 1000, "rate": rate},
            "http_req_failed": {"value": 0.01},
        }})
        self.shard(1, summary_json=summary(300, 50))
        self.shard(2, exit_code=99, summary_json=summary(600, 50))
        result = verdict.build_verdict(manifest("k6", 2, {"p95_ms": 500, "min_rps": 90}), self.results)
        self.assertEqual(result["metrics"]["p95_ms"], 600)
        self.assertEqual(result["metrics"]["rps"], 100)
        self.assertFalse(result["metrics"]["exact"])
        self.assertEqual(result["status"], verdict.FAILED)

    def test_k6_crash_is_invalid(self):
        self.shard(1, exit_code=107)
        result = verdict.build_verdict(manifest("k6"), self.results)
        self.assertEqual(result["status"], verdict.INVALID)

    def test_sla_metric_unavailable_is_invalid(self):
        self.shard(1, summary_json=json.dumps({"metrics": {
            "http_req_duration": {"p(95)": 100},
            "http_reqs": {"count": 10, "rate": 1},
            "http_req_failed": {"value": 0},
        }}))
        result = verdict.build_verdict(manifest("k6", sla={"p99_ms": 800}), self.results)
        self.assertEqual(result["status"], verdict.INVALID)

    def test_gatling_nonzero_with_stats_is_failed(self):
        stats = json.dumps({
            "numberOfRequests": {"total": 200, "ok": 190, "ko": 10},
            "percentiles3": {"total": 450},
            "percentiles4": {"total": 900},
            "meanNumberOfRequestsPerSecond": {"total": 20.0},
        })
        self.shard(1, exit_code=1, global_stats_json=stats)
        result = verdict.build_verdict(manifest("gatling", sla={"error_rate_pct": 1}), self.results)
        self.assertEqual(result["metrics"]["error_rate_pct"], 5.0)
        self.assertEqual(result["status"], verdict.FAILED)

    def test_junit_counts(self):
        self.shard(1, exit_code=3, kpi_jtl=self.jtl([(1000, 700, True)]))
        xml = verdict.junit(verdict.build_verdict(manifest("jmeter", sla={"p95_ms": 500}), self.results))
        self.assertIn('failures="2"', xml)
        self.assertIn('errors="0"', xml)


if __name__ == "__main__":
    unittest.main()
