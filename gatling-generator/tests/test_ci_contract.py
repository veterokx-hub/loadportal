"""Simulation читает контракт lt-run: loadFactor в load, покрытие в smoke."""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

from app.gatling_generator import generate_gatling
from app.models import (
    AutoStop,
    CorrelationSource,
    CsvSource,
    Dataset,
    Extraction,
    ExtractionType,
    LoadConfig,
    Param,
    ParamLocation,
    Request,
    ScenarioDraft,
    SourceType,
)
from app.models import TestMode as LoadTestMode


def _scenario(**load) -> ScenarioDraft:
    return ScenarioDraft(
        name="ci-contract",
        source_type=SourceType.OPENAPI,
        base_url="https://sut.example",
        load=LoadConfig(**load) if load else LoadConfig(),
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


def _simulation(scenario: ScenarioDraft | None = None) -> str:
    files = generate_gatling(scenario or _scenario()).files
    java = next(f for f in files if f.name.endswith("PortalSimulation.java"))
    return java.content


def _builders(java: str) -> dict[str, str]:
    marker = "private final ScenarioBuilder "
    chunks = java.split(marker)[1:]
    out: dict[str, str] = {}
    for chunk in chunks:
        name = chunk.split("=", 1)[0].strip()
        out[name] = chunk.split(";", 1)[0]
    return out


def test_simulation_honors_runner_contract():
    java = _simulation()
    readme = next(
        f.content for f in generate_gatling(_scenario()).files if f.name == "README.md"
    )

    assert 'System.getProperty("loadFactor"' in java
    assert 'System.getProperty("baseUrl"' in java
    assert 'System.getProperty("lt.mode"' in java
    assert 'Long.getLong("lt.smokeDurationSec", 60L)' in java
    assert "IllegalArgumentException" in java
    assert "constantUsersPerSec(1).during(Duration.ofSeconds(SMOKE_SEC))" in java
    assert ".maxDuration(Duration.ofSeconds(SMOKE_SEC + 60))" in java

    for name in ("login", "order", "login#2"):
        assert f'details("{name}").allRequests().count().gt(0L)' in java

    builders = _builders(java)
    assert "group0" in builders and "group0Smoke" in builders
    assert "group1" in builders and "group1Smoke" in builders
    for key, body in builders.items():
        if key.endswith("Smoke"):
            assert "Autostop::record" not in body
            assert "crashLoadGeneratorIf" not in body
        else:
            assert "Autostop::record" in body
            assert "crashLoadGeneratorIf" in body

    smoke_arm, load_arm = java.split("if (SMOKE)", 1)[1].split("} else {", 1)
    assert "constantUsersPerSec(1)" in smoke_arm
    assert "LOAD_FACTOR" not in smoke_arm.split("constantUsersPerSec(1)", 1)[0][-80:]
    assert "randomized()" not in smoke_arm
    assert "* LOAD_FACTOR" in load_arm
    for line in load_arm.splitlines():
        if "UsersPerSec(" in line or ".to(" in line or "startingFrom(" in line:
            assert "* LOAD_FACTOR" in line
        if ".during(Duration.ofSeconds(" in line or "eachLevelLasting" in line:
            assert "LOAD_FACTOR" not in line.split("Duration.ofSeconds", 1)[-1]

    assert "Запуск в CI" in readme
    assert "k6 run -e LT_MODE=smoke -e LT_SMOKE_DURATION_SEC=10 script.js" in readme
    assert "mvn gatling:test -Dlt.mode=smoke -Dlt.smokeDurationSec=10" in readme


def test_max_search_scales_both_rates():
    java = _simulation(_scenario(test_mode=LoadTestMode.MAX_SEARCH, steps=4, step_duration_sec=30))
    _, load_arm = java.split("if (SMOKE)", 1)[1].split("} else {", 1)
    assert "incrementUsersPerSec(" in load_arm
    assert "startingFrom(" in load_arm
    for line in load_arm.splitlines():
        if "incrementUsersPerSec(" in line or "startingFrom(" in line:
            assert "* LOAD_FACTOR" in line
        if "eachLevelLasting" in line:
            assert "LOAD_FACTOR" not in line


@pytest.mark.skipif(shutil.which("mvn") is None, reason="maven не установлен")
def test_maven_test_compile():
    result = generate_gatling(_scenario())
    jdk = Path("/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home")
    env = os.environ.copy()
    if jdk.is_dir():
        env["JAVA_HOME"] = str(jdk)
        env["PATH"] = str(jdk / "bin") + os.pathsep + env.get("PATH", "")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        for item in result.files:
            path = root / item.name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(item.content, encoding="utf-8")
        proc = subprocess.run(
            ["mvn", "-q", "test-compile"],
            cwd=root,
            capture_output=True,
            text=True,
            env=env,
            timeout=180,
        )
        assert proc.returncode == 0, proc.stdout + "\n" + proc.stderr
