"""gatling-generator — сервис генерации Gatling-проектов из доменной модели Scenario."""
from __future__ import annotations

import hmac
import io
import os
import time
import zipfile

from fastapi import FastAPI, HTTPException, Request, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from .gatling_generator import generate_gatling
from .metrics import ARTIFACT_SIZE, GENERATE_DURATION, GENERATE_TOTAL
from .models import ScenarioDraft

app = FastAPI(title="Load Test Portal — Gatling Generator", version="0.1.0")

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
    return {"status": "ok", "service": "gatling-generator"}


@app.get("/ready")
def ready() -> dict[str, str]:
    return {"status": "ok", "service": "gatling-generator"}


@app.get("/metrics")
def metrics() -> Response:
    """Экспозиция Prometheus-метрик для VictoriaMetrics."""
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.post("/generate/gatling")
def generate_gatling_endpoint(scenario: ScenarioDraft, request: Request) -> Response:
    _require_internal(request.headers.get("X-Internal-Token"))
    # Артефакт всегда zip: Gatling исполняет скомпилированную Simulation, значит нужен проект.
    started = time.perf_counter()
    fmt = "zip"
    try:
        result = generate_gatling(scenario)
    except Exception as exc:  # noqa: BLE001
        GENERATE_TOTAL.labels(format=fmt, result="failure").inc()
        GENERATE_DURATION.labels(format=fmt, result="failure").observe(
            time.perf_counter() - started
        )
        raise HTTPException(status_code=422, detail="Не удалось собрать Gatling-проект") from exc

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in result.files:
            zf.writestr(_zip_path(f.name), f.content)
    body = buf.getvalue()
    GENERATE_TOTAL.labels(format=fmt, result="success").inc()
    GENERATE_DURATION.labels(format=fmt, result="success").observe(time.perf_counter() - started)
    ARTIFACT_SIZE.labels(format=fmt).observe(len(body))
    return Response(
        content=body,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{result.filename}.zip"'},
    )


def _zip_path(name: str) -> str:
    segs = []
    for raw in (name or "").replace("\\", "/").split("/"):
        if not raw or raw in {".", ".."}:
            continue
        cleaned = "".join(c if c.isalnum() or c in "._-" else "_" for c in raw)
        if cleaned:
            segs.append(cleaned)
    return "/".join(segs) if segs else "file.txt"


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("APP_PORT", "8002")))
