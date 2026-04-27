# TOEFL Listen and Repeat Trainer

Personal TOEFL Listen and Repeat trainer focused on low-latency practice, Azure Pronunciation Assessment, SQLite history, and reinforcement drills.

## Mac Local Development

Active self-use now runs directly on this Mac. The fixed local URL is:

```text
http://127.0.0.1:5174/
```

From the project workspace:

```bash
cd /Users/wuliuqi/Documents/New\ project
scripts/start_mac_dev.sh --open
```

For a double-click startup on macOS, use:

```text
scripts/Start TOEFL Trainer.command
```

You can also place a copy of that `.command` file on the Desktop. It starts the Mac backend/frontend, keeps the ports fixed, and opens the app.

Self-use mode keeps practice history on this Mac under the project directory:

```text
/Users/wuliuqi/Documents/New project/data/toefl_repeat.sqlite3
/Users/wuliuqi/Documents/New project/attempts
/Users/wuliuqi/Documents/New project/data/audio/generated
```

To inspect local persistence and service status:

```bash
scripts/start_mac_dev.sh --status
```

To stop the local dev services cleanly:

```bash
scripts/start_mac_dev.sh --stop
```

## Windows Remote Development (Backup)

Windows remote `toefl-win` is now optional backup capacity. Use it only if the Mac is unavailable or a task explicitly needs Windows-side verification.

```bash
scripts/start_windows_dev.sh --self-use
scripts/windows_first.sh build
```

## Deploy As A Web App (Option 2)

This repo is now deployable as a single container service: FastAPI serves both API and built frontend.

## Local vs Cloud Testing Model

Use one TOEFL Trainer site with modules such as Speaking, Reading, and future Listening/Writing features. Do not split each module into a separate web app unless the product becomes large enough to need independent deployments.

- Local self-use: Mac runs the app and stores your long-term data under `/Users/wuliuqi/Documents/New project`.
- Cloud friend testing: Render hosts a small shared testing version with its own `/data` disk.
- Local and cloud data are intentionally separate. Do not sync personal SQLite data or recordings from Mac to Render.
- Cloud deploys are manual. Validate locally first, then push/deploy when the version is ready for friends.

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
   - `INTERVIEW_AI_PROVIDER=deepseek`
   - `INTERVIEW_REFERENCE_PROVIDER=deepseek`
   - `DEEPSEEK_API_KEY`
   - `DEEPSEEK_MODEL=deepseek-v4-flash`
   - `DEEPSEEK_BASE_URL=https://api.deepseek.com`
   - `APP_DATABASE_PATH=/data/toefl_repeat.sqlite3`
   - `APP_ATTEMPTS_DIR=/data/attempts`
   - `APP_PROMPT_AUDIO_DIR=/data/audio/generated`
   - `APP_FRONTEND_DIST_DIR=frontend/dist`
5. Add a persistent disk mounted at `/data` so attempts and recordings survive restarts.
6. Keep auto-deploy disabled for the friend-testing service.
7. Manually deploy and open your Render URL (HTTPS).

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
