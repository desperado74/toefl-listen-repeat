# RUNBOOK

## Windows-First Development

Default for active development:

- Use the Mac only as the control plane for chat, SSH commands, and browser access.
- Run heavy commands on Windows remote `toefl-win`.
- Windows project path: `D:\Projects\toefl-listen-repeat`
- Mac browser URL: `http://127.0.0.1:5174/`

Remote helper from the Mac workspace:

```bash
cd /Users/wuliuqi/Documents/New\ project
scripts/start_windows_dev.sh --sync
scripts/windows_first.sh sync
scripts/windows_first.sh check
```

Daily start / recover command:

```bash
cd /Users/wuliuqi/Documents/New\ project
scripts/start_windows_dev.sh
```

Use this whenever the browser cannot reach the app after sleep, restart, or network interruption. It keeps the heavy processes on Windows and only recreates Mac-side SSH tunnels when needed.

Individual remote checks:

```bash
scripts/windows_first.sh build
scripts/windows_first.sh compile
scripts/windows_first.sh validate-listen
scripts/windows_first.sh validate-interview
scripts/windows_first.sh validate-reading
scripts/windows_first.sh smoke-reading
```

Do not run frontend production builds, long-running dev servers, or bulk validation on the Mac unless explicitly requested. If the Windows copy is out of sync, run `scripts/windows_first.sh sync` first.

## Local Development (Optional)

Use this only when intentionally running the app on the Mac:

```bash
cd /Users/wuliuqi/Documents/New\ project
npm install
npm --prefix frontend install
python3 -m pip install -r backend/requirements.txt
npm run dev
```

Frontend:

- `http://127.0.0.1:5174`

Backend:

- `http://127.0.0.1:8000`

## Production Build Check

```bash
cd /Users/wuliuqi/Documents/New\ project
scripts/windows_first.sh build
scripts/windows_first.sh compile
```

## Listen and Repeat Content Maintenance

Run validation on Windows through the helper script by default:

```bash
cd /Users/wuliuqi/Documents/New\ project
scripts/windows_first.sh validate-listen
```

Outputs:

- Scenario bank: `data/scenarios/listen_repeat.json`
- Validation report: `data/reports/listen_repeat_bank_report.json`

Direct Windows commands when intentionally regenerating content:

```powershell
cd D:\Projects\toefl-listen-repeat
.\.venv\Scripts\python.exe data\tools\build_listen_repeat_bank.py
.\.venv\Scripts\python.exe data\tools\validate_listen_repeat_bank.py
```

## Reading Content Maintenance

Run this on Windows through the helper script by default:

```bash
cd /Users/wuliuqi/Documents/New\ project
scripts/windows_first.sh validate-reading
```

Direct Windows command:

```powershell
cd D:\Projects\toefl-listen-repeat
.\.venv\Scripts\python.exe data\tools\validate_reading_bank.py
```

## Speaking Interview Content Maintenance

Run this on Windows through the helper script by default:

```bash
cd /Users/wuliuqi/Documents/New\ project
scripts/windows_first.sh validate-interview
```

Direct Windows command:

```powershell
cd D:\Projects\toefl-listen-repeat
.\.venv\Scripts\python.exe data\tools\validate_interview_bank.py
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
- `APP_SESSION_COOKIE_SECURE=1` (HTTPS)

## Render Deploy Steps

1. Push `main` branch to GitHub.
2. In Render, create `Web Service` from repo (Docker runtime).
3. Mount persistent disk:
   - path: `/data`
4. Set all env vars above. For small friend testing, require at least:
   - `AZURE_SPEECH_KEY`
   - `AZURE_SPEECH_REGION`
   - `DEEPSEEK_API_KEY`
   - `INTERVIEW_AI_PROVIDER=deepseek`
   - `INTERVIEW_REFERENCE_PROVIDER=deepseek`
   - `DEEPSEEK_MODEL=deepseek-v4-flash`
   - `APP_ACCESS_PASSWORD`
   - `APP_SESSION_SECRET`
   - `APP_SESSION_COOKIE_SECURE=1`
   - `APP_DATABASE_PATH=/data/toefl_repeat.sqlite3`
   - `APP_ATTEMPTS_DIR=/data/attempts`
   - `APP_PROMPT_AUDIO_DIR=/data/audio/generated`
   - `APP_PROMPT_TTS_PROVIDER=azure`
5. Deploy.
6. Smoke test:
   - `/api/health` returns `ok`
   - unlock page appears if password enabled
   - complete one sentence scoring cycle
   - complete one Interview answer and confirm transcript + DeepSeek training score

## Git Push (Google Login Account)

If HTTPS push asks for password:

- Use GitHub fine-grained token as the password
- Scope: repository `desperado74/toefl-listen-repeat`
- Permission needed: Contents `Read and write`
