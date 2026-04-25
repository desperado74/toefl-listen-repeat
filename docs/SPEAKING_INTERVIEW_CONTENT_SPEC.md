# Speaking Interview Content Spec

Last updated: 2026-04-25

## Product Shape

- Speaking contains two practice modes:
  - Listen and Repeat: 7 prompted sentences with syllable progression.
  - Interview: 4 simulated interview questions around one theme.
- Interview content is original TOEFL-style training material. Do not copy official ETS questions.
- Each Interview question plays an interviewer prompt, then gives the learner 45 seconds to answer.

## Interview Set Rules

- Each set must contain exactly 4 questions.
- All 4 questions must share one coherent theme, such as campus life, academic support, student services, academic policy, or career preparation.
- `answerSeconds` must be `45`.
- Interviewer text should be natural spoken English and should fit roughly 10-15 seconds when read aloud.
- Keep each interviewer text under 240 characters so it can be served by `/api/prompt-audio-text.mp3`.

## Question Progression

Use this progression unless there is a strong content reason to vary it:

1. Personal experience, habit, or familiar situation.
2. Preference or choice between two or three options.
3. Evaluation, problem analysis, or cause/effect reasoning.
4. Advice, recommendation, or solution design.

## Feedback Policy

- Do not show a fake official score.
- The app saves audio, duration, transcript, and mixed training-feedback fields.
- Interview v2 uses Azure Speech-to-Text when configured, then generates rule-based feedback.
- Feedback dimensions are Delivery, Language Use, Topic Development, and Organization.
- Label all output as training feedback, not an official ETS score.
- Future paid AI scoring should plug into the existing feedback fields instead of replacing saved audio/STT metrics.
- DeepSeek scoring, when enabled, must evaluate both content completeness and speech/STT metrics. Do not score from transcript alone.

## Reference Answer Policy

- Reference answers must only be available after the learner has saved an attempt for that question.
- Target answer level is about 4.5/5: clear, natural, complete, but not an over-polished memorized script.
- Keep answers around 80-110 words for a 45-second response.
- Use simple, practical English:
  - direct answer
  - one or two reasons
  - one small example
  - short closing
- Cache generated answers by set/question/provider/model/target level to avoid repeated paid calls.

## Validation

Run on Windows by default:

```bash
scripts/windows_first.sh validate-interview
```

Direct Windows command:

```powershell
cd D:\Projects\toefl-listen-repeat
.\.venv\Scripts\python.exe data\tools\validate_interview_bank.py
```
