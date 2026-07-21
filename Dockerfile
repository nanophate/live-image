ARG LIVING_IMAGE_TARGET=living-image-huggingface

FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS web-build

WORKDIR /web
COPY package.json package-lock.json tsconfig.json vite.config.ts /web/
COPY index.html inspect.html compare.html validate.html viewer.html /web/
COPY src /web/src
COPY fixtures/validation/report.json /web/fixtures/validation/report.json
RUN npm install --global npm@11.16.0 \
    && npm ci \
    && npm run build

FROM python:3.12.10-slim-bookworm@sha256:fd95fa221297a88e1cf49c55ec1828edd7c5a428187e67b5d1805692d11588db AS compiler-runtime

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
COPY requirements/container.lock.txt /app/requirements/container.lock.txt
RUN python -m pip install --no-cache-dir \
      --index-url https://download.pytorch.org/whl/cpu \
      --no-deps \
      torch==2.2.2+cpu torchvision==0.17.2+cpu \
    && python -m pip install --no-cache-dir -r /app/requirements/container.lock.txt

COPY compiler/__init__.py compiler/compile_character.py compiler/preload_models.py /app/compiler/
RUN python -m compiler.preload_models
COPY compiler /app/compiler

ENV HF_HUB_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    LIVING_IMAGE_TORCH_THREADS=1 \
    LIVING_IMAGE_TORCH_INTEROP_THREADS=1

RUN useradd --create-home --uid 1000 living-image \
    && chmod -R a=rX /app /opt/living-image
USER 1000:1000

EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/ping', timeout=2).read()"]

FROM compiler-runtime AS living-image-cloudflare
CMD ["python", "-m", "compiler.container_api", "--offline"]

FROM compiler-runtime AS living-image-huggingface
COPY --from=web-build --chown=1000:1000 /web/dist /app/dist
CMD ["python", "-m", "compiler.hosted_server", "--root", "/app/dist", "--offline"]

FROM ${LIVING_IMAGE_TARGET} AS runtime
