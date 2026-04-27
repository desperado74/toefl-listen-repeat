# RUNBOOK

## Mac Local Development

Default for active development:

- Run TOEFL Trainer directly on this Mac.
- Keep the browser URL fixed at `http://127.0.0.1:5174/`.
- Store personal practice data locally in this project directory.
- Use Windows remote `toefl-win` only as optional backup capacity.

Main helper:

```bash
cd /Users/wuliuqi/Documents/New\ project
scripts/start_mac_dev.sh --open
```

The helper starts the backend on port `8000`, the frontend on port `5174`, waits for health checks, and opens the app when `--open` is passed.

Double-click startup on macOS:

```text
scripts/Start TOEFL Trainer.command
```

Keep a Desktop copy if desired. It runs `scripts/start_mac_dev.sh --open` and opens `http://127.0.0.1:5174/`.

Persistent self-use storage on Mac:

```text
/Users/wuliuqi/Documents/New project/data/toefl_repeat.sqlite3
/Users/wuliuqi/Documents/New project/attempts
/Users/wuliuqi/Documents/New project/data/audio/generated
```

Check service and storage status:

```bash
scripts/start_mac_dev.sh --status
```

Stop local dev services cleanly:

```bash
scripts/start_mac_dev.sh --stop
```

Daily start / recover command:

```bash
cd /Users/wuliuqi/Documents/New\ project
scripts/start_mac_dev.sh --open
```

Use this whenever the browser cannot reach the app after sleep or reboot.

## Validation

```bash
git diff --check
.venv/bin/python -m compileall backend/app
.venv/bin/python data/tools/validate_listen_repeat_bank.py
.venv/bin/python data/tools/validate_interview_bank.py
.venv/bin/python data/tools/validate_reading_bank.py
npm --prefix frontend run build
```

## Windows Remote Development (Backup)

Windows remote is no longer the default, but the old helpers are kept:

```bash
scripts/start_windows_dev.sh --self-use
scripts/start_windows_dev.sh --status
scripts/start_windows_dev.sh --stop
scripts/windows_first.sh build
scripts/windows_first.sh compile
```

Use these only when intentionally testing or running on `toefl-win`.

## Manual Local Commands

If the helper is not used:

```bash
cd /Users/wuliuqi/Documents/New\ project
.venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
npm --prefix frontend run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

Frontend:

- `http://127.0.0.1:5174`

Backend:

- `http://127.0.0.1:8000`

## Production Build Check

Use the validation commands above before publishing.

## Local-to-Cloud Release Model

Use one TOEFL Trainer app for current and future modules. Add new practice areas as in-app modules by default, not as separate deployments.

Data policy:

- Mac self-use data stays local: `/Users/wuliuqi/Documents/New project/data` and `/Users/wuliuqi/Documents/New project/attempts`.
- Render friend-testing data stays on the Render disk mounted at `/data`.
- Do not automatically sync SQLite files or recordings between Mac and Render.

Release policy:

1. Finish the feature locally.
2. Run local Mac checks.
3. Push the ready version to GitHub.
4. Manually deploy/confirm Render.
5. Smoke test the hosted URL before sharing with friends.

Before adding a new module to cloud, confirm:

- The module appears in the built frontend.
- Required data folders are copied by `Dockerfile`.
- Required environment variables are listed in `.env.example`, `render.yaml`, and this runbook.
- At least one core browser flow can complete and save a record.

## Listen and Repeat Content Maintenance

Run validation locally:

```bash
cd /Users/wuliuqi/Documents/New\ project
.venv/bin/python data/tools/validate_listen_repeat_bank.py
```

Outputs:

- Scenario bank: `data/scenarios/listen_repeat.json`
- Validation report: `data/reports/listen_repeat_bank_report.json`

Regenerate content locally:

```bash
cd /Users/wuliuqi/Documents/New\ project
.venv/bin/python data/tools/build_listen_repeat_bank.py
.venv/bin/python data/tools/validate_listen_repeat_bank.py
```

## Reading Content Maintenance

Run this locally:

```bash
cd /Users/wuliuqi/Documents/New\ project
.venv/bin/python data/tools/validate_reading_bank.py
```

## Speaking Interview Content Maintenance

Run this locally:

```bash
cd /Users/wuliuqi/Documents/New\ project
.venv/bin/python data/tools/validate_interview_bank.py
```

Outputs:

- Interview bank: `data/interview/interview_bank.json`
- Content spec: `docs/SPEAKING_INTERVIEW_CONTENT_SPEC.md`

## Key Runtime Env Vars

- `AZURE_SPEECH_KEY`
- `AZURE_SPEECH_REGION`
- `APP_PROMPT_TTS_PROVIDER=azure` (for cloud)
- `APP_PROMPT_AZURE_VOICE=en-US-JennyNeural`
- `INTERVIEW_AI_PROVIDER=none` (set to `deepseek` for DeepSeek non-official Interview scoring)
- `INTERVIEW_REFERENCE_PROVIDER=local` (the in-app DeepSeek settings box switches this to `deepseek`)
- `DEEPSEEK_API_KEY` (optional, only for DeepSeek reference answers)
- `DEEPSEEK_MODEL=deepseek-v4-flash`
- `DEEPSEEK_BASE_URL=https://api.deepseek.com`
- `APP_DATABASE_PATH=/data/toefl_repeat.sqlite3`
- `APP_ATTEMPTS_DIR=/data/attempts`
- `APP_PROMPT_AUDIO_DIR=/data/audio/generated`
- `APP_ACCESS_PASSWORD` (optional, recommended)
- `APP_SESSION_SECRET` (required when password enabled)
- `APP_VISITOR_COOKIE_NAME=trainer_visitor` (anonymous per-browser attempt isolation)
- `APP_SESSION_COOKIE_SECURE=1` (HTTPS)

## Render Deploy Steps

1. Push the locally verified `main` branch to GitHub.
2. In Render, create `Web Service` from repo (Docker runtime).
3. Disable auto-deploy for the small friend-testing service.
4. Mount persistent disk:
   - path: `/data`
5. Set all env vars above. For small friend testing, require at least:
   - `AZURE_SPEECH_KEY`
   - `AZURE_SPEECH_REGION`
   - `DEEPSEEK_API_KEY`
   - `INTERVIEW_AI_PROVIDER=deepseek`
   - `INTERVIEW_REFERENCE_PROVIDER=deepseek`
   - `DEEPSEEK_MODEL=deepseek-v4-flash`
   - `APP_ACCESS_PASSWORD`
   - `APP_SESSION_SECRET`
   - `APP_VISITOR_COOKIE_NAME=trainer_visitor`
   - `APP_SESSION_COOKIE_SECURE=1`
   - `APP_DATABASE_PATH=/data/toefl_repeat.sqlite3`
   - `APP_ATTEMPTS_DIR=/data/attempts`
   - `APP_PROMPT_AUDIO_DIR=/data/audio/generated`
   - `APP_PROMPT_TTS_PROVIDER=azure`
6. Manually deploy.
7. Smoke test:
   - `/api/health` returns `ok`
   - unlock page appears if password enabled
   - complete one sentence scoring cycle
   - complete one Interview answer and confirm transcript + DeepSeek training score
   - complete Reading Router and confirm it routes to Lower/Upper, then submit the full 50-item simulation
   - open in another browser/incognito session and confirm attempts start empty

## Git Push (Google Login Account)

If HTTPS push asks for password:

- Use GitHub fine-grained token as the password
- Scope: repository `desperado74/toefl-listen-repeat`
- Permission needed: Contents `Read and write`
