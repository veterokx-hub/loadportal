FROM python:3.12-slim@sha256:78387bc3881b8273120a12ebe6c1ab22b018ccc2c9adf565ae1ac9b536e184ea

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    APP_PORT=8000 \
    HOME=/tmp

RUN groupadd --system --gid 888 app \
    && useradd --system --uid 888 --gid 888 --no-create-home --home-dir /tmp --shell /usr/sbin/nologin app

COPY --chown=root:root --chmod=0444 requirements.lock .
RUN pip install --no-cache-dir -r requirements.lock

COPY --chown=root:root --chmod=0555 app ./app

USER 888:888
EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${APP_PORT}"]
