# Frontend build
FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Backend dependencies
FROM python:3.13-slim AS backend-build
WORKDIR /app/backend
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/
COPY backend/pyproject.toml backend/uv.lock backend/.python-version ./
RUN uv sync --frozen --no-dev
COPY backend/*.py ./

# Runtime
FROM python:3.13-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg nginx curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/
COPY --from=backend-build /app/backend /app/backend
COPY --from=frontend-build /app/frontend/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /docker-entrypoint.sh

RUN chmod +x /docker-entrypoint.sh \
    && mkdir -p /app/backend/data/audio \
    && rm -f /etc/nginx/sites-enabled/default

ENV TORCH_NUM_THREADS=2
ENV WHISPER_MODEL=abhinav-spidey/Whisper-ml-v1

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
  CMD curl -f http://localhost/api/recordings/count || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
