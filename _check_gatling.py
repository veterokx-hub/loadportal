"""Черновой прогон генератора Gatling (удаляется после проверки)."""
import json
import pathlib
import sys

from app.gatling_generator import generate_gatling
from app.models import ScenarioDraft

SCENARIO = {
    "name": "Demo Gatling",
    "source_type": "openapi",
    "base_url": "https://api.example.com",
    "load": {
        "test_mode": "ramp_hold",
        "steps": 5,
        "step_duration_sec": 60,
        "assumed_latency_sec": 0.5,
    },
    "datasets": [
        {
            "id": "ds1",
            "name": "users",
            "file_name": "users.csv",
            "columns": ["login", "password"],
            "rows": [["u1", "p1"], ["u2", "p,2"]],
            "random": False,
        }
    ],
    "autostop": {
        "enabled": True,
        "error_rate_pct": 5,
        "error_rate_sec": 30,
        "avg_response_ms": 800,
        "avg_response_sec": 20,
    },
    "prometheus": {"exporter_port": 9001, "run_id": "42", "samplers_reg_exp": ".*", "slo_levels": "0.1;1"},
    "requests": [
        {
            "id": "r1",
            "order": 1,
            "name": "login",
            "method": "POST",
            "path": "/auth/login",
            "headers": [{"key": "X-Trace", "value": "portal"}],
            "body": {
                "mode": "json",
                "content_type": "application/json",
                "content": "{\"login\": \"{login}\", \"password\": \"{password}\", \"nonce\": \"{nonce}\"}",
            },
            "params": [
                {"name": "login", "location": "body", "source": {"kind": "csv", "column": "login"}, "required": True},
                {"name": "password", "location": "body", "source": {"kind": "csv", "column": "password"}, "required": True},
                {"name": "nonce", "location": "body", "source": {"kind": "generator", "generator": {"type": "uuid"}}, "required": False},
            ],
            "extractions": [
                {"variable": "token", "type": "json", "expression": "$.token", "match_no": 1, "default_value": "NOT_FOUND"}
            ],
            "intensity": {"target_rps": 20, "ramp_up_sec": 30, "hold_sec": 120},
            "validation": {"check_response_code": True, "expected_status": 200, "response_contains": "token"},
            "dataset_id": "ds1",
            "repeat": 1,
        },
        {
            "id": "r2",
            "order": 2,
            "name": "get profile",
            "method": "GET",
            "path": "/users/{userId}/profile",
            "headers": [{"key": "Authorization", "value": "Bearer ${token}"}],
            "body": {"mode": "none", "content": ""},
            "params": [
                {"name": "userId", "location": "path", "source": {"kind": "generator", "generator": {"type": "counter", "start": 1, "increment": 1, "max": 1000, "format": "0000"}}, "required": True},
                {"name": "trace", "location": "header", "source": {"kind": "generator", "generator": {"type": "randomString", "length": 12, "chars": "abcdef0123456789"}}, "required": False},
                {"name": "page", "location": "query", "source": {"kind": "generator", "generator": {"type": "randomInt", "min": 1, "max": 10}}, "required": False},
                {"name": "ts", "location": "query", "source": {"kind": "generator", "generator": {"type": "timestamp", "format": "yyyy-MM-dd"}}, "required": False},
            ],
            "extractions": [
                {"variable": "email", "type": "boundary", "expression": "\"email\":\"|\"", "match_no": 1, "default_value": "none"}
            ],
            "intensity": {"target_rps": 20, "ramp_up_sec": 30, "hold_sec": 120},
            "validation": {"check_response_code": True, "expected_status": 200, "response_contains": ""},
            "dataset_id": "ds1",
            "repeat": 3,
        },
        {
            "id": "r3",
            "order": 3,
            "name": "search",
            "method": "GET",
            "path": "/search",
            "headers": [],
            "body": {"mode": "none", "content": ""},
            "params": [
                {"name": "q", "location": "query", "source": {"kind": "constant", "value": "phone"}, "required": False}
            ],
            "extractions": [],
            "intensity": {"target_rps": 7.5, "ramp_up_sec": 0, "hold_sec": 90},
            "validation": {"check_response_code": True, "expected_status": 200, "response_contains": ""},
            "dataset_id": None,
            "repeat": 1,
        },
    ],
}

mode = sys.argv[1] if len(sys.argv) > 1 else "ramp_hold"
SCENARIO["load"]["test_mode"] = mode
result = generate_gatling(ScenarioDraft(**SCENARIO))
out = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else None
for f in result.files:
    if out:
        p = out / f.name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(f.content, encoding="utf-8")
    else:
        print("=" * 20, f.name, "=" * 20)
        print(f.content)
print("files:", [f.name for f in result.files], file=sys.stderr)
