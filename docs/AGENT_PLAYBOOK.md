# AGENT PLAYBOOK

Last updated: 2026-04-25
Workspace: `/Users/wuliuqi/Documents/New project`

## Goal

Use a stable multi-agent workflow to keep context clean, avoid long-thread drift, and ship features continuously.

## Runtime Placement

- Default execution target is Windows remote `toefl-win`.
- Mac should be treated as a control plane for chat, SSH, lightweight file edits, and browser access.
- Heavy commands must run on Windows unless the user explicitly asks otherwise:
  - frontend build / dev server
  - backend compile / dev server
  - API smoke tests
  - content validation and bulk data processing
- Use `scripts/windows_first.sh` from the Mac workspace for sync and remote checks.
- Windows project path: `D:\Projects\toefl-listen-repeat`

## Topology

1. Main Agent (Orchestrator)
- Owns planning, task split, integration, and acceptance.
- Does not do large direct implementation unless urgent hotfix.

2. Worker FE
- Write scope: `frontend/src/**`, `frontend/index.html`, `frontend/vite.config.ts`
- Must not edit backend/data/docs except for tiny type contract updates requested by Main Agent.

3. Worker BE
- Write scope: `backend/app/**`, `backend/requirements.txt`
- Must not edit frontend UI or scenario data unless requested.

4. Worker DATA
- Write scope: `data/**`, `docs/**`
- Owns scenario expansion, reinforcement material, and documentation continuity.

## Non-Overlap Rule

- Every task must have explicit file ownership.
- Two workers must not edit the same file in parallel.
- If overlap is unavoidable, Main Agent serializes the tasks.

## Canonical Artifacts

Main Agent always keeps these files current:

- `docs/HANDOFF.md`
- `docs/ROADMAP.md`
- `docs/RUNBOOK.md`
- `docs/WORKLOG.md` (append-only short log)

If context is reset, these files are source of truth.

## Task Card Template

Use this exact structure for each worker assignment:

```md
Task ID: <id>
Owner: <FE|BE|DATA>
Goal: <single clear objective>
Input Files:
- <abs or repo path>
- <abs or repo path>
Allowed Write Scope:
- <glob/path>
Out of Scope:
- <explicitly forbidden edits>
Acceptance Criteria:
- <testable item 1>
- <testable item 2>
Verification:
- <commands the worker must run>
Return Format:
- Files changed
- What changed
- Verification output
- Risks / follow-ups
```

## Worker Return Contract

Worker must return:

1. `Files changed`
2. `Behavior change summary`
3. `Verification run` (commands + key output)
4. `Risk or unknowns`

No long narrative. No unrelated refactor.

## Main Agent Merge Gate

Before integrating any worker result:

1. Build checks
- `scripts/windows_first.sh build`
- `scripts/windows_first.sh compile`

2. Smoke checks
- `GET /api/health` returns `ok`
- One record -> score -> save cycle works
- Auth gate works when password env is enabled

3. Data checks (if DATA touched)
- Scenario JSON parses
- Reinforcement scenario endpoint returns valid payload
- Reading bank changes pass `scripts/windows_first.sh validate-reading`

## Branching Model

Use short-lived branches:

- `main` is always deployable.
- Feature branches:
  - `codex/fe-<topic>`
  - `codex/be-<topic>`
  - `codex/data-<topic>`
  - `codex/integration-<topic>`

Main Agent merges only after merge gate passes.

## Session Lifecycle

1. Session Start (Main Agent)
- Read `docs/HANDOFF.md`, `docs/ROADMAP.md`, `docs/RUNBOOK.md`, `docs/WORKLOG.md`.
- Pick one stage goal only.

2. Execution
- Split into small Task Cards.
- Dispatch by ownership boundary.
- Integrate and verify.

3. Session End
- Update `HANDOFF`, `ROADMAP` (if priorities changed), `RUNBOOK` (if ops changed).
- Append 3-8 lines into `WORKLOG`.

## Context Budget Policy

Use a hard budget to avoid context overflow:

1. Maximum 2 major features per session.
2. If discussion grows beyond one screen without code movement, summarize to `WORKLOG` and continue.
3. If token pressure appears, stop feature work and do a continuity checkpoint:
- update docs
- commit
- open a fresh session

## Conflict Resolution

If worker output conflicts with current local state:

1. Prefer current repository truth, not stale worker assumption.
2. Ask worker to rebase mentally and resubmit small delta.
3. Never force-reset user changes.

## First Priority Queue (Current Project)

1. Stabilize deployment pipeline (Render + env + smoke checks).
2. Expand scenario bank and reinforcement drills.
3. Improve feedback specificity (word/phoneme/actionable drills).
4. Add session analytics view.
