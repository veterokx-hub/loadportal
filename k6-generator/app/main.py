"""k6-generator — сервис генерации k6-скриптов из доменной модели Scenario."""
from __future__ import annotations

import hmac
import io
import os
import time
import zipfile

from fastapi import FastAPI, HTTPException, Request, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from .k6_generator import generate_k6
from .metrics import ARTIFACT_SIZE, GENERATE_DURATION, GENERATE_TOTAL
from .models import ScenarioDraft

app = FastAPI(title="Load Test Portal — k6 Generator", version="0.1.0")

_INTERNAL_TOKEN = os.getenv("LOADTEST_INTERNAL_TOKEN", "").strip()


def _require_internal(token: str | None) -> None:
    if not _INTERNAL_TOKEN:
        return
    left = hmac.new(b"ltp", _INTERNAL_TOKEN.encode(), "sha256").digest()
    right = hmac.new(b"ltp", (token or "").encode(), "sha256").digest()
    if not hmac.compare_digest(left, right):
        raise HTTPException(status_code=401, detail="Требуется внутренний токен")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "k6-generator"}


@app.get("/ready")
def ready() -> dict[str, str]:
    return {"status": "ok", "service": "k6-generator"}


@app.get("/metrics")
def metrics() -> Response:
    """Экспозиция Prometheus-метрик для VictoriaMetrics."""
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.post("/generate/k6")
def generate_k6_endpoint(scenario: ScenarioDraft, request: Request) -> Response:
    _require_internal(request.headers.get("X-Internal-Token"))
    # Артефакт всегда zip: script.js и локальные библиотеки (без jslib.k6.io).
    started = time.perf_counter()
    try:
        result = generate_k6(scenario)
    except Exception as exc:  # noqa: BLE001
        GENERATE_TOTAL.labels(format="unknown", result="failure").inc()
        GENERATE_DURATION.labels(format="unknown", result="failure").observe(
            time.perf_counter() - started
        )
        raise HTTPException(status_code=422, detail="Не удалось собрать k6-скрипт") from exc

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("script.js", result.script)
        for f in result.data_files:
            zf.writestr(_zip_entry(f.name), f.content)
    body = buf.getvalue()
    fmt = "zip"
    GENERATE_TOTAL.labels(format=fmt, result="success").inc()
    GENERATE_DURATION.labels(format=fmt, result="success").observe(time.perf_counter() - started)
    ARTIFACT_SIZE.labels(format=fmt).observe(len(body))
    return Response(
        content=body,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{result.filename}.zip"'},
    )


def _zip_entry(name: str) -> str:
    normalized = (name or "").replace("\\", "/").lstrip("/")
    parts = [p for p in normalized.split("/") if p and p != "."]
    if parts and parts[0] == "lib" and ".." not in parts:
        return "/".join(parts)
    return _zip_name(normalized)


def _zip_name(name: str) -> str:
    base = os.path.basename((name or "data.csv").replace("\\", "/"))
    base = "".join(c if c.isalnum() or c in "._-" else "_" for c in base)
    if not base or ".." in base:
        return "data.csv"
    return base


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("APP_PORT", "8001")))
