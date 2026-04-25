# WORKLOG

Append-only log. Keep each entry short (3-8 lines).

## 2026-04-25

- Added Reading adaptive simulation v1 with original public content only: Router module plus Lower/Upper second modules.
- Added 50-item full Reading paths calibrated to ETS public structure: 30 Complete the Words items plus Daily Life/Academic items.
- Added adaptive Reading APIs, SQLite session persistence, frontend Adaptive/Single Set modes, and stricter Reading bank validation.

- Added Speaking Interview v1 alongside Listen and Repeat under the Speaking column.
- Added 12 original Interview sets with 4 theme-linked questions each and 45-second answer timing.
- Added Interview API and SQLite persistence with reserved transcript, AI feedback, rubric score, and scoring status fields.
- Added Interview bank validator and Windows-first `validate-interview` command.
- Added Interview content spec and updated operational docs for the new Speaking mode.
- Upgraded Interview attempts to v2 mixed feedback: Azure STT when configured, duration/WPM metrics, and four training dimensions.
- Kept paid LLM scoring disabled by default, with provider space reserved for OpenAI, Qwen, or DeepSeek later.
- Added post-attempt Interview reference answers with cached local generation and optional DeepSeek provider wiring.
- Re-centered DeepSeek integration on Interview scoring: DeepSeek receives prompt, transcript, STT metrics, and baseline feedback to produce non-official 0-5 training scores.
- Updated the in-app DeepSeek settings flow so one key enables both DeepSeek scoring and DeepSeek reference-answer generation.
- Prepared deployment config for small shared testing: Docker now includes Reading/Interview banks, Render env includes DeepSeek, and docs list the required invite-only env vars.

- Rebuilt Listen and Repeat bank around TOEFL-style 7-sentence syllable progression.
- Added per-sentence `difficultyStage` and `estimatedSyllables` metadata.
- Mixed the 180-scenario order so difficulty and topic no longer appear in large blocks.
- Extended Listen and Repeat validation to enforce syllable bands, ordering, duplicate checks, and mixed level runs.
- Added frontend sentence-level difficulty and syllable labels.
- Versioned regenerated sentence ids with `v2` so old attempts do not attach to changed prompts.
- Filtered training plan, analytics, reinforcement, and attempt hydration to current-bank sentence ids.

- Tightened Reading v1 practice flow: submit is enabled only after all 18 items are answered.
- Renamed Reading result scale copy to training reference wording instead of implying an official estimate.
- Added missed-answer option text for Reading multiple-choice review cards.
- Verified on Windows remote: Reading validator, backend compile, frontend build, and Reading API smoke.
- Tested Reading in the browser with intentional wrong answers and verified result breakdown plus missed-answer explanations.
- Hardened `scripts/start_windows_dev.sh` so the backend runs inside the SSH tunnel session with log redirection, avoiding stale/empty 8000 tunnel responses.

- Corrected Reading Complete the Words from four-choice vocabulary prompts to C-test style typed word-completion blanks.
- Updated the 3 Reading seed sets to 54 scoring items: 10 Complete the Words blanks, 3 Daily Life questions, and 5 Academic Passage questions per set.
- Updated backend scoring, frontend rendering, and Reading bank validation for mixed typed-blank and multiple-choice answers.
- Verified on Windows remote: Reading validator, backend compile, frontend build, API smoke with 18-item first set, and browser submit flow.

- Added Windows-first development workflow so Mac stays a lightweight control plane.
- Added `scripts/windows_first.sh` for source sync and remote build/compile/Reading API smoke through `toefl-win`.
- Added `data/tools/validate_reading_bank.py` for Reading seed bank structure and answer-key validation.
- Updated runbook/playbook/handoff to make Windows remote the default place for heavy checks.
- Moved README/RUNBOOK baseline commands away from Mac-local heavy checks and ignored local scratch artifacts.
- Fixed the Windows-first frontend browser port at `127.0.0.1:5174` to avoid Vite port drift.
- Added `scripts/start_windows_dev.sh` to recover Windows backend/frontend and Mac SSH tunnels with one command.

- Added Reading v1 module skeleton based on 2026 TOEFL iBT Reading task types.
- Added 3 original high-quality Reading seed sets in `data/reading/reading_bank.json` with 42 total questions.
- Added Reading APIs for set list/detail and scored attempt submission with SQLite persistence.
- Added frontend Reading tab, timed practice flow, answer selection, Chinese explanations, and result review.
- Verified on Windows remote: frontend build, backend compile, Reading set API, and Reading submit API.

## 2026-04-24

- Added multi-agent operating model in `docs/AGENT_PLAYBOOK.md`.
- Defined Main Agent + FE/BE/DATA worker boundaries and merge gate.
- Added context continuity policy to reduce token overflow risk.
- Next recommended action: use Task Cards for the next feature batch.
- Added session analytics aggregation for recent trend, weakest sentences, and improving sentences.
- Exposed analytics via `/api/session-analytics` and rendered a frontend analytics panel.
- Verified frontend build, backend compile, and analytics aggregation against local SQLite data.
- Next recommended action: improve reinforcement specificity and add spaced review behavior.
- Localized most non-exam UI copy into Chinese, including controls, states, analytics, and feedback section labels.
- Kept English training content such as sentence text, recognized text body, weak words, and phoneme symbols intact.
- Expanded `Listen and Repeat` to a 180-scenario curated bank while preserving the original 8 scenario ids.
- Added `topic` / `sourceType` metadata plus backend defaults so large-bank content stays app-compatible.
- Added content maintenance tools: `data/tools/build_listen_repeat_bank.py` and `data/tools/validate_listen_repeat_bank.py`.
- Validation now confirms 45 easy / 90 medium / 45 hard and zero exact duplicate sentence texts.
- Next recommended action: open a fresh agent for Listen and Repeat training-effect optimization; re-plan Reading separately later.
- Upgraded the training plan into an actionable review queue with priority labels, reasons, and suggested actions.
- Reinforcement pack now prefers weak original sentences from recent attempts before falling back to generic drills.
- Frontend training panel now shows an execution-style review queue instead of only sentence ids.
- Verified backend compile, frontend build, and local SQLite sanity checks for the new review queue and reinforcement behavior.
- Added spaced-review scheduling fields: review stage, due label, target gap days, and top-level review summary.
- Training plan headline and panel copy now reflect what is due now versus what can wait until the next window.
