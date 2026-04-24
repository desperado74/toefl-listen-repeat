# TOEFL Listen and Repeat Trainer

Personal TOEFL Listen and Repeat trainer focused on low-latency practice, Azure Pronunciation Assessment, SQLite history, and reinforcement drills.

## Local Development

1. Copy `.env.example` to `.env` and set `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION`.
2. Install dependencies:

```bash
npm install
npm --prefix frontend install
python3 -m pip install -r backend/requirements.txt
```

3. Start frontend and backend:

```bash
npm run dev
```

4. Open `http://127.0.0.1:5173`.

## Deploy As A Web App (Option 2)

This repo is now deployable as a single container service: FastAPI serves both API and built frontend.

### Deploy on Render (recommended quick path)

1. Push this repo to GitHub.
2. Create a new Render `Web Service` from the repo.
3. Runtime: `Docker` (Render will use the `Dockerfile`).
4. Set environment variables:
   - `AZURE_SPEECH_KEY`
   - `AZURE_SPEECH_REGION` (for example `eastus`)
   - `APP_ACCESS_PASSWORD` (optional but recommended for shared access)
   - `APP_SESSION_SECRET` (long random string, required when password is enabled)
   - `APP_SESSION_COOKIE_SECURE=1` (keep enabled on HTTPS hosting)
   - `APP_PROMPT_TTS_PROVIDER=azure`
   - `APP_PROMPT_AZURE_VOICE=en-US-JennyNeural`
   - `APP_DATABASE_PATH=/data/toefl_repeat.sqlite3`
   - `APP_ATTEMPTS_DIR=/data/attempts`
   - `APP_PROMPT_AUDIO_DIR=/data/audio/generated`
5. Add a persistent disk mounted at `/data` so attempts and recordings survive restarts.
6. Deploy and open your Render URL (HTTPS).

### Why HTTPS matters

Browser microphone access is much more reliable on `https://` origins than plain `http://` internet hosts.

### Access Password Behavior

- If `APP_ACCESS_PASSWORD` is empty: app is open.
- If `APP_ACCESS_PASSWORD` is set: app shows an unlock page first.
- Session uses an HttpOnly cookie. Rotate `APP_SESSION_SECRET` to invalidate all existing sessions.

## Runtime Notes

- Browser speech recognition is not used for scoring.
- Client audio is scored by Azure Pronunciation Assessment using reference text.
- Backend stores raw Azure JSON, normalized diagnostics, and recordings.
- Prompt audio generation supports:
  - `APP_PROMPT_TTS_PROVIDER=azure` (cloud-friendly, recommended for deployment)
  - `APP_PROMPT_TTS_PROVIDER=local` (macOS `say` + `ffmpeg`)
  - `APP_PROMPT_TTS_PROVIDER=auto` (try Azure first, then local)
