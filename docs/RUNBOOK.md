# RUNBOOK

## Local Development

```bash
cd /Users/wuliuqi/Documents/New\ project
npm install
npm --prefix frontend install
python3 -m pip install -r backend/requirements.txt
npm run dev
```

Frontend:

- `http://127.0.0.1:5173`

Backend:

- `http://127.0.0.1:8000`

## Production Build Check

```bash
cd /Users/wuliuqi/Documents/New\ project
npm --prefix frontend run build
python3 -m compileall backend/app
```

## Key Runtime Env Vars

- `AZURE_SPEECH_KEY`
- `AZURE_SPEECH_REGION`
- `APP_PROMPT_TTS_PROVIDER=azure` (for cloud)
- `APP_PROMPT_AZURE_VOICE=en-US-JennyNeural`
- `APP_DATABASE_PATH=/data/toefl_repeat.sqlite3`
- `APP_ATTEMPTS_DIR=/data/attempts`
- `APP_PROMPT_AUDIO_DIR=/data/audio/generated`
- `APP_ACCESS_PASSWORD` (optional, recommended)
- `APP_SESSION_SECRET` (required when password enabled)
- `APP_SESSION_COOKIE_SECURE=1` (HTTPS)

## Render Deploy Steps

1. Push `main` branch to GitHub.
2. In Render, create `Web Service` from repo (Docker runtime).
3. Mount persistent disk:
   - path: `/data`
4. Set all env vars above.
5. Deploy.
6. Smoke test:
   - `/api/health` returns `ok`
   - unlock page appears if password enabled
   - complete one sentence scoring cycle

## Git Push (Google Login Account)

If HTTPS push asks for password:

- Use GitHub fine-grained token as the password
- Scope: repository `desperado74/toefl-listen-repeat`
- Permission needed: Contents `Read and write`
