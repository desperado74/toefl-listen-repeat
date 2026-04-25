FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM python:3.11-slim AS runtime
WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install -r /app/backend/requirements.txt

COPY backend /app/backend
COPY data/interview /app/data/interview
COPY data/reading /app/data/reading
COPY data/scenarios /app/data/scenarios
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

RUN mkdir -p /data/attempts /data/audio/generated /app/data

EXPOSE 8000

CMD sh -c "uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT:-8000}"
