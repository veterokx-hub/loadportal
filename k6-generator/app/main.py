"""k6-generator — сервис генерации k6-скриптов из доменной модели Scenario."""
from __future__ import annotations

import io
import os
import zipfile

from fastapi import FastAPI, HTTPException, Response

from .k6_generator import generate_k6
from .models import ScenarioDraft

app = FastAPI(title="Load Test Portal — k6 Generator", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/generate/k6")
def generate_k6_endpoint(scenario: ScenarioDraft) -> Response:
    try:
        result = generate_k6(scenario)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"Не удалось собрать k6-скрипт: {exc}") from exc

    if not result.is_zip:
        return Response(
            content=result.script.encode("utf-8"),
            media_type="application/javascript",
            headers={"Content-Disposition": f'attachment; filename="{result.filename}.js"'},
        )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("script.js", result.script)
        for f in result.data_files:
            zf.writestr(f.name, f.content)
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{result.filename}.zip"'},
    )


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("APP_PORT", "8001")))
