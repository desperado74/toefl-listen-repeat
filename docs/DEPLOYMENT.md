# Deployment Guide

## Container Model

The `Dockerfile` uses a multi-stage build: Node builds the frontend, then a Python runtime serves both the static frontend and FastAPI application on one port.

## Required Secrets

Configure these in the hosting provider. Do not add their values to source control.

- `AZURE_SPEECH_KEY`
- `APP_ACCESS_PASSWORD`
- `APP_SESSION_SECRET`
- `DEEPSEEK_API_KEY` when DeepSeek feedback is enabled

## Runtime Configuration

- `AZURE_SPEECH_REGION`
- `APP_SESSION_COOKIE_SECURE=1`
- `APP_PROMPT_TTS_PROVIDER=azure`
- `APP_PROMPT_AZURE_VOICE=en-US-JennyNeural`
- `INTERVIEW_AI_PROVIDER=deepseek`
- `INTERVIEW_REFERENCE_PROVIDER=deepseek`
- `DEEPSEEK_MODEL=deepseek-v4-flash`
- `DEEPSEEK_BASE_URL=https://api.deepseek.com`
- `APP_DATABASE_PATH=/data/toefl_repeat.sqlite3`
- `APP_ATTEMPTS_DIR=/data/attempts`
- `APP_PROMPT_AUDIO_DIR=/data/audio/generated`
- `APP_FRONTEND_DIST_DIR=frontend/dist`

## Persistent Storage

Mount a persistent disk at `/data`. This keeps SQLite data, recordings and generated prompt audio outside the application image and preserves them across deploys.

## Release Checklist

1. Run all content validators.
2. Build the frontend and compile the backend.
3. Confirm no secrets or personal runtime data are tracked by Git.
4. Deploy the verified commit.
5. Confirm `/api/health` returns `{"status":"ok"}`.
6. Confirm the access gate rejects an incorrect password.
7. Complete one Listen & Repeat assessment.
8. Complete one Interview response and verify transcription plus feedback.
9. Confirm a stored attempt remains available after a service restart.
