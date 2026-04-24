# ROADMAP

## Stage 1 (Finish Now)

1. Push code to GitHub private repo
2. Deploy on Render with HTTPS
3. Configure:
   - `AZURE_SPEECH_KEY`
   - `AZURE_SPEECH_REGION`
   - `APP_ACCESS_PASSWORD`
   - `APP_SESSION_SECRET`
4. Verify:
   - login gate works
   - mic permission works on hosted URL
   - scoring/feedback/training plan work end-to-end

## Stage 2 (Listen+Repeat Strengthening)

1. Add larger scenario pool (difficulty ladders)
2. Add spaced review by weak words/phonemes
3. Add retry strategy and queue for Azure errors/timeouts
4. Add per-session analytics dashboard

## Stage 3 (Reading Expansion)

1. Reading practice module with timed passages
2. Question bank + answer review + error taxonomy
3. Link reading mistakes to vocabulary reinforcement deck

## Stage 4 (Writing Expansion)

1. Integrated writing prompt workflow
2. Draft evaluation rubric + targeted rewrite suggestions
3. Revision history and score improvement tracking

## Session Continuity Rule

Before ending any major session:

1. Update `docs/HANDOFF.md`
2. Update `docs/ROADMAP.md` if priorities changed
3. Add operational changes into `docs/RUNBOOK.md`
4. Commit with a small, explicit message
