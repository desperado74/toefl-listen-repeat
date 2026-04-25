# Listen and Repeat Content Spec

Last updated: 2026-04-25

## Target

- Total scenarios: `180`
- Level distribution:
  - `easy`: `45`
  - `medium`: `90`
  - `hard`: `45`
- Scenario order:
  - mixed by default, using `easy -> medium -> hard -> medium`
  - no long blocks of the same scenario level
- Structure per scenario:
  - `id`
  - `title`
  - `context`
  - `level`
  - `topic`
  - `sourceType`
  - `sentences` (exactly `7`)
    - `difficultyStage`
    - `estimatedSyllables`

## Quality Rules

- Keep the current app-compatible shape. Existing keys must remain usable by the frontend and backend.
- Model the 2026 Listen and Repeat task as one scenario with seven spoken prompts.
- Control sentence difficulty primarily by estimated syllable count:
  - Sentences `1-2`: `9-11` syllables, `easy`
  - Sentences `3-5`: `14-16` syllables, `medium`
  - Sentences `6-7`: `19-23` syllables, `hard`
- Use word count only as a sanity check; syllables are the hard content rule.
- Within each scenario, keep sentence order fixed from easiest to hardest.
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
- Use `data/tools/validate_listen_repeat_bank.py` to check counts, duplicates, topic coverage, mixed ordering, and syllable bands.
