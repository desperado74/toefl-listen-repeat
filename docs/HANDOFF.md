# HANDOFF

Last updated: 2026-04-26
Workspace: `/Users/wuliuqi/Documents/New project`
Repo: `https://github.com/desperado74/toefl-listen-repeat`

## Current Product Scope

- TOEFL Listen and Repeat (self-use trainer)
- TOEFL Reading short practice v1
- Azure Pronunciation Assessment as scoring core
- FastAPI backend + React frontend + SQLite
- Reinforcement scenario generation based on weak words/phonemes
- Optional app-level password gate for hosted usage
- One-app module strategy: Speaking, Reading, and future Listening/Writing live inside the same TOEFL Trainer site by default
- Two runtime tracks:
  - Mac self-use stores personal data locally
  - Render friend-testing stores separate shared test data on `/data`

## Implemented

- End-to-end record -> score -> save -> feedback flow
- Word/phoneme-level diagnostics from Azure normalized output
- Immediate feedback panel + detailed coaching list
- Training plan and recommended drill queue
- Session analytics panel with recent trend, weakest sentences, and improving sentences
- Expanded scenario bank to 180 curated scenarios with topic metadata
- Training-effect upgrades:
  - actionable review queue in training plan
  - priority labels and suggested actions per sentence
  - reinforcement pack now prioritizes weak original sentences before generic drills
  - spaced-review fields: review stage, due label, target gap, and review summary
- Offline content tooling:
  - `data/tools/build_listen_repeat_bank.py`
  - `data/tools/validate_listen_repeat_bank.py`
  - `data/reports/listen_repeat_bank_report.json`
- Prompt audio generation (Azure TTS for cloud, local fallback)
- Deployment files:
  - `Dockerfile`
  - `render.yaml`
  - `.env.example`
- Password protection:
  - backend auth endpoints
  - API guard middleware
  - frontend unlock screen
- Reading v1:
  - 3 original shortened seed sets / 54 scoring items
  - adaptive Reading simulation v1 adds Router -> Lower/Upper modules for a 50-item full practice path
  - adaptive content is original TOEFL-style only; official ETS materials are used for calibration, not copied into the public bank
  - Complete the Words now uses short C-test style passages with 10 typed word-completion blanks per set
  - Read in Daily Life now uses 3 questions per set, plus Academic Passage sections
  - timed practice UI, complete-before-submit flow, Chinese explanations, score review, missed-answer text, and skill breakdown
  - `/api/reading/sets`, `/api/reading/sets/{set_id}`, `/api/reading/adaptive`, `/api/reading/modules/{module_id}`, `/api/reading/attempts`
- Speaking Interview v1:
  - Speaking now contains Listen and Repeat plus Interview modes
  - 12 original Interview sets / 48 questions
  - 4-question theme-based interview flow with 45-second answer recordings
  - SQLite persistence for Interview attempts with transcript and mixed training-feedback fields
  - Interview v2 uses Azure Speech-to-Text when configured, then generates non-official rule-based feedback for Delivery, Language Use, Topic Development, and Organization
  - Interview reference answer v1 is available after a question attempt is saved; default provider is local cached generation, with DeepSeek provider wiring reserved
  - `/api/interview/sets`, `/api/interview/sets/{set_id}`, `/api/interview/attempts`

## Verified

- Frontend build succeeds locally with `npm --prefix frontend run build`
- Backend imports/compile succeed locally with `.venv/bin/python -m compileall backend/app`
- Analytics aggregation runs against local SQLite attempt history
- Listen and Repeat bank validation passes:
  - 180 scenarios total
  - level split 45 easy / 90 medium / 45 hard
  - scenario order is mixed instead of level-blocked
  - every scenario has 7 prompts with 9-11 / 14-16 / 19-23 estimated syllable bands
  - 0 exact duplicate sentence texts
- Training plan sanity check passes against local SQLite attempts:
  - returns review queue entries with priority labels
  - returns spaced-review summary and due labels
  - returns reinforcement pack with 7 sentences
- Auth behavior:
  - no password -> APIs accessible
  - password set -> protected APIs return 401 until login
- Reading v1:
  - `npm --prefix frontend run build`
  - `.venv\Scripts\python.exe -m compileall backend\app`
  - `/api/reading/sets` returns 3 sets
  - `/api/reading/attempts` returns mixed typed-blank + multiple-choice scored breakdown
- Mac local workflow restored:
  - `scripts/start_mac_dev.sh --open` starts backend/frontend directly on Mac
  - `scripts/Start TOEFL Trainer.command` and the Desktop shortcut call the Mac helper
  - `scripts/start_windows_dev.sh` and `scripts/windows_first.sh` remain as backup only
  - Reading bank validation runs with `data/tools/validate_reading_bank.py`
  - Frontend dev URL is fixed at `http://127.0.0.1:5174/`
- Local-to-cloud release policy:
  - validate locally on Mac first
  - keep Mac SQLite/recordings separate from Render `/data`
  - manually deploy Render after a ready push

## Pending

- Push local git commits to GitHub remote `origin main` (blocked only by GitHub token auth)
- Create or maintain Render web service from GitHub repo with auto-deploy disabled
- Set Render environment variables and persistent disk `/data`
- Final deploy smoke test on public HTTPS URL
- Continue Listen and Repeat optimization with deeper spaced review logic and richer drill specificity
- Expand Reading content beyond the 3 shortened seed sets after UI/flow feedback

## Notes

- Azure key was previously exposed in chat. Rotate key in Azure portal before production usage.
- Keep repository private by default for self-use.
- For friend testing, use the Render deployment as a separate low-cost test environment with shared password access.
- Do not sync local Mac practice records to Render unless a future explicit export/import feature is designed.
- Default development validation should run on Mac unless the user explicitly asks for Windows remote verification.
- Regenerate the scenario bank locally with `.venv/bin/python data/tools/build_listen_repeat_bank.py`.
- Validate the scenario bank with `.venv/bin/python data/tools/validate_listen_repeat_bank.py`.
- Validate Reading bank with `.venv/bin/python data/tools/validate_reading_bank.py`.
- Validate Interview bank with `.venv/bin/python data/tools/validate_interview_bank.py`.
- Interview feedback currently uses `INTERVIEW_AI_PROVIDER=none` by default. Future provider options are reserved for `openai`, `qwen`, and `deepseek`, but no paid LLM scoring API is called yet.
- To enable DeepSeek scoring, set `INTERVIEW_AI_PROVIDER=deepseek`, `DEEPSEEK_API_KEY`, and optionally `DEEPSEEK_MODEL=deepseek-v4-flash`. DeepSeek receives the Interview prompt, transcript, duration/WPM/word count, recognition confidence, and baseline feedback, then returns a non-official 0-5 training score.
- The in-app DeepSeek settings box enables both `INTERVIEW_AI_PROVIDER=deepseek` and `INTERVIEW_REFERENCE_PROVIDER=deepseek`, using the same `DEEPSEEK_API_KEY`.
- Multi-agent collaboration is now documented in:
  - `docs/AGENT_PLAYBOOK.md`
  - `docs/NEW_SESSION_PROMPT.md`
  - `docs/WORKLOG.md`
