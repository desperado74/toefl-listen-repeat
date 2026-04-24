# HANDOFF

Last updated: 2026-04-24
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
- Expanded scenario bank (more than initial two sets)
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
- Auth behavior:
  - no password -> APIs accessible
  - password set -> protected APIs return 401 until login

## Pending

- Push local git commits to GitHub remote `origin main` (blocked only by GitHub token auth)
- Create Render web service from GitHub repo
- Set Render environment variables and persistent disk `/data`
- Final deploy smoke test on public HTTPS URL

## Notes

- Azure key was previously exposed in chat. Rotate key in Azure portal before production usage.
- Keep repository private by default for self-use.
