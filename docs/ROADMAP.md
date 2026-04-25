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

1. Optimize reinforcement specificity on top of the 180-scenario bank
2. Add spaced review / review queue by weak words and phonemes
3. Add retry strategy and queue for Azure errors/timeouts
4. Deepen analytics dashboard with filters and longer-term trends

## Stage 2B (Speaking Interview)

1. Expand Interview set count after v1 flow feedback
2. Improve open-response transcription fallback and retry controls
3. Add optional AI rubric feedback through a cost-controlled provider
4. Track Interview history by theme and question focus

## Stage 3 (Reading Expansion)

1. Re-plan Reading in a dedicated session before implementation
2. Reading practice module with timed passages
3. Question bank + answer review + error taxonomy
4. Link reading mistakes to vocabulary reinforcement deck

## Stage 4 (Writing Expansion)

1. Integrated writing prompt workflow
2. Draft evaluation rubric + targeted rewrite suggestions
3. Revision history and score improvement tracking

## Session Continuity Rule

Before ending any major session:

1. Update `docs/HANDOFF.md`
2. Update `docs/ROADMAP.md` if priorities changed
3. Add operational changes into `docs/RUNBOOK.md`
4. Append session notes into `docs/WORKLOG.md`
5. Commit with a small, explicit message
