"""k6-generator — сервис генерации k6-скриптов из доменной модели Scenario."""
from __future__ import annotations

import io
import os
import time
import zipfile

from fastapi import FastAPI, HTTPException, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from .k6_generator import generate_k6
from .metrics import ARTIFACT_SIZE, GENERATE_DURATION, GENERATE_TOTAL
from .models import ScenarioDraft

app = FastAPI(title="Load Test Portal — k6 Generator", version="0.1.0")


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
def generate_k6_endpoint(scenario: ScenarioDraft) -> Response:
    # Формат заранее неизвестен: generate_k6 сам решает, нужен ли zip с датасетами.
    # Поэтому в failure-метке используем "unknown", а успех пишем с фактическим форматом.
    started = time.perf_counter()
    try:
        result = generate_k6(scenario)
    except Exception as exc:  # noqa: BLE001
        GENERATE_TOTAL.labels(format="unknown", result="failure").inc()
        GENERATE_DURATION.labels(format="unknown", result="failure").observe(
            time.perf_counter() - started
        )
        raise HTTPException(status_code=422, detail=f"Не удалось собрать k6-скрипт: {exc}") from exc

    if not result.is_zip:
        body = result.script.encode("utf-8")
        fmt = "js"
        GENERATE_TOTAL.labels(format=fmt, result="success").inc()
        GENERATE_DURATION.labels(format=fmt, result="success").observe(time.perf_counter() - started)
        ARTIFACT_SIZE.labels(format=fmt).observe(len(body))
        return Response(
            content=body,
            media_type="application/javascript",
            headers={"Content-Disposition": f'attachment; filename="{result.filename}.js"'},
        )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("script.js", result.script)
        for f in result.data_files:
            zf.writestr(f.name, f.content)
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


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("APP_PORT", "8001")))
