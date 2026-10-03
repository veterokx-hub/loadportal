import os
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))

import child_pipeline  # noqa: E402

IMAGES = {
    "LT_IMAGE_JMETER": "registry.corp/lt/lt-jmeter@sha256:" + "a" * 64,
    "LT_IMAGE_K6": "registry.corp/lt/lt-k6@sha256:" + "b" * 64,
    "LT_IMAGE_GATLING": "registry.corp/lt/lt-gatling@sha256:" + "c" * 64,
    "LT_IMAGE_CI_TOOLS": "registry.corp/lt/lt-ci-tools@sha256:" + "d" * 64,
}


def manifest(tool: str = "k6", shards: int = 1, smoke: bool = False, profile: str = "load") -> dict:
    return {
        "run": {"tool": tool, "profile": profile},
        "computed": {
            "shards": shards,
            "run_label": 'nt-1 "quoted"',
            "smoke": {"enabled": smoke, "budget_sec": 300},
            "resources": {"cpu": "4", "memory": "8Gi"},
            "schedule": {"job_timeout_sec": 3601},
        },
    }


class ChildPipelineTest(unittest.TestCase):
    @mock.patch.dict(os.environ, IMAGES, clear=True)
    def test_single_shard_has_no_parallel(self):
        text = child_pipeline.render(manifest())
        self.assertNotIn("parallel:", text)
        self.assertIn(IMAGES["LT_IMAGE_K6"], text)
        self.assertIn('timeout: "61m"', text)
        self.assertIn('KUBERNETES_MEMORY_LIMIT: "8Gi"', text)

    @mock.patch.dict(os.environ, IMAGES, clear=True)
    def test_shards_and_tool_image(self):
        text = child_pipeline.render(manifest("gatling", 4))
        self.assertIn("parallel: 4", text)
        self.assertIn(IMAGES["LT_IMAGE_GATLING"], text)

    @mock.patch.dict(os.environ, {}, clear=True)
    def test_missing_image_is_environment_error(self):
        with self.assertRaises(SystemExit) as ctx:
            child_pipeline.render(manifest())
        self.assertEqual(ctx.exception.code, child_pipeline.EXIT_ENVIRONMENT)

    @mock.patch.dict(os.environ, IMAGES, clear=True)
    def test_output_is_valid_yaml(self):
        try:
            import yaml
        except ImportError:
            self.skipTest("PyYAML не установлен")
        doc = yaml.safe_load(child_pipeline.render(manifest("jmeter", 3)))
        self.assertEqual(doc["generate"]["parallel"], 3)
        self.assertEqual(doc["generate"]["variables"]["GIT_STRATEGY"], "none")
        self.assertEqual(doc["generate"]["variables"]["LT_MODE"], "load")
        self.assertEqual(doc["gate"]["when"], "always")
        self.assertNotIn("smoke", doc)

    @mock.patch.dict(os.environ, IMAGES, clear=True)
    def test_smoke_gates_generate(self):
        try:
            import yaml
        except ImportError:
            self.skipTest("PyYAML не установлен")
        doc = yaml.safe_load(child_pipeline.render(manifest("gatling", 4, smoke=True)))
        self.assertEqual(doc["stages"], ["smoke", "generate", "gate", "publish"])
        self.assertNotIn("parallel", doc["smoke"])
        self.assertEqual(doc["smoke"]["variables"]["LT_MODE"], "smoke")
        self.assertIn({"job": "smoke", "artifacts": True}, doc["smoke-check"]["needs"])
        self.assertIn({"job": "smoke-check", "artifacts": False}, doc["generate"]["needs"])
        gate_jobs = [need.get("job") for need in doc["gate"]["needs"]]
        self.assertEqual(gate_jobs, ["pre-check", "smoke", "generate"])

    @mock.patch.dict(os.environ, IMAGES, clear=True)
    def test_smoke_profile_has_no_load(self):
        text = child_pipeline.render(manifest("k6", smoke=True, profile="smoke"))
        self.assertIn("stages: [smoke, gate, publish]", text)
        self.assertIn("allow_failure: true", text)
        self.assertIn("python3 ci/lib/publish.py", text)
        self.assertNotIn("generate:", text)
        self.assertNotIn("smoke-check:", text)
        yaml_mod = _yaml()
        if yaml_mod is not None:
            doc = yaml_mod.safe_load(text)
            self.assertTrue(doc["publish"]["allow_failure"])
            self.assertEqual(doc["publish"]["when"], "always")
            self.assertEqual(doc["publish"]["needs"], [{"job": "gate", "artifacts": True}])


    @mock.patch.dict(
        os.environ,
        {**IMAGES, "LT_VAULT_SERVER_URL": "https://vault.corp.local", "LT_VAULT_AUTH_ROLE": "lt-ci"},
        clear=True,
    )
    def test_secrets_only_on_generators(self):
        spec = manifest("k6", 2, smoke=True)
        spec["secrets"] = [{"name": "TOKEN", "vault": "loadtest/payments/TOKEN@kv"}]
        text = child_pipeline.render(spec)
        self.assertEqual(text.count("LT_SECRET_TOKEN:"), 2)
        self.assertNotIn("LT_SECRET_TOKEN", text.split("gate:", 1)[1])
        self.assertIn("https://vault.corp.local", text)
        self.assertIn("file: false", text)
        yaml_mod = _yaml()
        if yaml_mod is not None:
            doc = yaml_mod.safe_load(text)
            self.assertEqual(doc["generate"]["secrets"]["LT_SECRET_TOKEN"]["vault"], "loadtest/payments/TOKEN@kv")
            self.assertNotIn("secrets", doc["gate"])
            self.assertNotIn("secrets", doc["publish"])

    @mock.patch.dict(os.environ, IMAGES, clear=True)
    def test_secrets_without_vault_url(self):
        spec = manifest()
        spec["secrets"] = [{"name": "TOKEN", "vault": "loadtest/payments/TOKEN@kv"}]
        with self.assertRaises(SystemExit) as ctx:
            child_pipeline.render(spec)
        self.assertEqual(ctx.exception.code, child_pipeline.EXIT_ENVIRONMENT)


def _yaml():
    try:
        import yaml
        return yaml
    except ImportError:
        return None


if __name__ == "__main__":
    unittest.main()
