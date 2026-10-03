"""Скрипт k6 читает контракт lt-run и сам проверяет покрытие smoke."""
from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

from app.k6_generator import generate_k6
from app.models import (
    AutoStop,
    CorrelationSource,
    CsvSource,
    Dataset,
    Extraction,
    ExtractionType,
    Param,
    ParamLocation,
    Request,
    ScenarioDraft,
    SourceType,
)


def _scenario() -> ScenarioDraft:
    return ScenarioDraft(
        name="ci-contract",
        source_type=SourceType.OPENAPI,
        base_url="https://sut.example",
        autostop=AutoStop(
            enabled=True,
            error_rate_pct=1,
            error_rate_sec=10,
            avg_response_ms=500,
            avg_response_sec=10,
        ),
        datasets=[
            Dataset(
                id="ds1",
                name="goods",
                file_name="goods.csv",
                columns=["sku"],
                rows=[["a"], ["b"]],
            )
        ],
        requests=[
            Request(
                id="r1",
                order=1,
                name="login",
                method="POST",
                path="/login",
                extractions=[
                    Extraction(variable="token", type=ExtractionType.JSON, expression="$.token")
                ],
            ),
            Request(
                id="r2",
                order=2,
                name="order",
                method="GET",
                path="/order",
                repeat=3,
                params=[
                    Param(
                        name="Authorization",
                        location=ParamLocation.HEADER,
                        source=CorrelationSource(variable="token"),
                    )
                ],
            ),
            Request(
                id="r3",
                order=3,
                name="login",
                method="GET",
                path="/catalog",
                dataset_id="ds1",
                params=[
                    Param(
                        name="sku",
                        location=ParamLocation.QUERY,
                        source=CsvSource(column="sku"),
                    )
                ],
            ),
        ],
    )


def test_script_honors_runner_contract():
    script = generate_k6(_scenario()).script

    assert "const LOAD_SCENARIOS" in script
    assert "const SMOKE_SCENARIOS" in script
    assert "__ENV.LT_MODE" in script
    assert "__ENV.BASE_URL" in script
    assert "__ENV.LT_SMOKE_DURATION_SEC" in script
    assert "ramping-arrival-rate" in script
    assert "constant-arrival-rate" in script
    assert "duration: `${SMOKE_SEC}s`" in script
    assert "rate: 1" in script
    assert "export function g0()" in script
    assert "export function g1()" in script
    assert "throw new Error(" in script
    assert "LT_MODE === 'smoke' ? SMOKE_SCENARIOS : LOAD_SCENARIOS" in script

    for name in ("login", "order"):
        assert f'"http_reqs{{name:{name}}}": ["count>0"]' in script
        assert f'tags: {{ name: "{name}" }}' in script
    assert '"http_reqs{name:\\"login#2\\"}": ["count>0"]' in script
    assert 'tags: { name: "login#2" }' in script

    smoke = script.split("const SMOKE_THRESHOLDS = ", 1)[1].split(";", 1)[0]
    load = script.split("const LOAD_THRESHOLDS = ", 1)[1].split(";", 1)[0]
    assert smoke.count("count>0") == 3
    assert "abortOnFail" not in smoke
    assert "abortOnFail" in load
    assert "portal_errors" in load

    for line in script.splitlines():
        stripped = line.strip()
        if stripped.startswith("import "):
            assert "https://" not in stripped
    assert "jslib.k6.io" not in script
    assert "export default function" not in script


@pytest.mark.skipif(shutil.which("k6") is None, reason="k6 не установлен")
def test_k6_inspect_both_modes():
    result = generate_k6(_scenario())
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "script.js").write_text(result.script, encoding="utf-8")
        for item in result.data_files:
            path = root / item.name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(item.content, encoding="utf-8")
        for mode in ("load", "smoke"):
            args = ["k6", "inspect", "-e", f"LT_MODE={mode}", "script.js"]
            if mode == "smoke":
                args[3:3] = ["-e", "LT_SMOKE_DURATION_SEC=10"]
            proc = subprocess.run(args, cwd=root, capture_output=True, text=True)
            assert proc.returncode == 0, proc.stderr + proc.stdout
            blob = proc.stdout + proc.stderr
            if mode == "smoke":
                assert "constant-arrival-rate" in blob
            else:
                assert "ramping-arrival-rate" in blob
