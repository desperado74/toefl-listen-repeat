# HANDOFF

Last updated: 2026-04-25
Workspace: `/Users/wuliuqi/Documents/New project`
Repo: `https://github.com/desperado74/toefl-listen-repeat`

## Current Product Scope

- TOEFL Listen and Repeat (self-use trainer)
- Azure Pronunciation Assessment as scoring core
- FastAPI backend + React frontend + SQLite
- Reinforcement scenario generation based on weak words/phonemes
- Optional app-level password gate for hosted usage

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

## Verified

- Frontend build succeeds (`npm --prefix frontend run build`)
- Backend imports/compile succeed
- Analytics aggregation runs against local SQLite attempt history
- Listen and Repeat bank validation passes:
  - 180 scenarios total
  - level split 45 easy / 90 medium / 45 hard
  - 0 exact duplicate sentence texts
- Training plan sanity check passes against local SQLite attempts:
  - returns review queue entries with priority labels
  - returns spaced-review summary and due labels
  - returns reinforcement pack with 7 sentences
- Auth behavior:
  - no password -> APIs accessible
  - password set -> protected APIs return 401 until login

## Pending

- Push local git commits to GitHub remote `origin main` (blocked only by GitHub token auth)
- Create Render web service from GitHub repo
- Set Render environment variables and persistent disk `/data`
- Final deploy smoke test on public HTTPS URL
- Continue Listen and Repeat optimization with deeper spaced review logic and richer drill specificity
- Re-plan Reading in a separate session before implementation

## Notes

- Azure key was previously exposed in chat. Rotate key in Azure portal before production usage.
- Keep repository private by default for self-use.
- Regenerate the scenario bank with `python3 data/tools/build_listen_repeat_bank.py`.
- Validate the scenario bank with `python3 data/tools/validate_listen_repeat_bank.py`.
- Multi-agent collaboration is now documented in:
  - `docs/AGENT_PLAYBOOK.md`
  - `docs/NEW_SESSION_PROMPT.md`
  - `docs/WORKLOG.md`
