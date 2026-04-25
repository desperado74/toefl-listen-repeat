# Listen and Repeat Content Spec

Last updated: 2026-04-25

## Target

- Total scenarios: `180`
- Level distribution:
  - `easy`: `45`
  - `medium`: `90`
  - `hard`: `45`
- Structure per scenario:
  - `id`
  - `title`
  - `context`
  - `level`
  - `topic`
  - `sourceType`
  - `sentences` (exactly `7`)

## Quality Rules

- Keep the current app-compatible shape. Existing keys must remain usable by the frontend and backend.
- Avoid exact duplicate sentence text across the entire bank.
- Avoid high-overlap scenario intent:
  - do not repeat the same campus task with only trivial wording changes
  - do not keep multiple variants whose training value is effectively identical
- Keep topics varied across academic, service, housing, health, career, transport, finance, safety, and community contexts.
- Keep source language natural, spoken, and easy to read aloud.

## Operational Rules

- `sourceType` defaults to `curated`.
- `topic` is required for coverage reporting and future filtering.
- Use `data/tools/build_listen_repeat_bank.py` to regenerate the bank.
- Use `data/tools/validate_listen_repeat_bank.py` to check counts, duplicates, and topic coverage.
