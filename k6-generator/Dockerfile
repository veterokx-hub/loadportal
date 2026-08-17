FROM python:3.12-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    APP_PORT=8001 \
    HOME=/tmp

RUN groupadd --system --gid 888 app \
    && useradd --system --uid 888 --gid 888 --no-create-home --home-dir /tmp --shell /usr/sbin/nologin app

COPY --chown=root:root --chmod=0444 requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=root:root --chmod=0555 app ./app

USER 888:888
EXPOSE 8001

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${APP_PORT}"]
