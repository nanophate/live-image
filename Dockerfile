FROM python:3.12.10-slim-bookworm@sha256:fd95fa221297a88e1cf49c55ec1828edd7c5a428187e67b5d1805692d11588db

ENV DEBIAN_FRONTEND=noninteractive \
    HF_HOME=/opt/living-image/model-cache \
    PYTHONPATH=/app \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

RUN apt-get update \
    && apt-get install --no-install-recommends --yes libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements/compiler.txt /app/requirements/compiler.txt
RUN python -m pip install --no-cache-dir \
      --index-url https://download.pytorch.org/whl/cpu \
      torch==2.2.2+cpu torchvision==0.17.2+cpu \
    && python -m pip install --no-cache-dir -r /app/requirements/compiler.txt

COPY compiler /app/compiler
RUN python -m compiler.preload_models

ENV HF_HUB_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1

RUN useradd --create-home --uid 10001 living-image \
    && chmod -R a=rX /app /opt/living-image
USER 10001:10001

EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/ping', timeout=2).read()"]
CMD ["python", "-m", "compiler.container_api", "--offline"]
