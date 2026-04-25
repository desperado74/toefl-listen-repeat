# NEW SESSION PROMPT

Use this when opening a fresh chat to continue the same project.

```text
Continue the TOEFL project in /Users/wuliuqi/Documents/New project.

Before coding, read:
1) docs/HANDOFF.md
2) docs/ROADMAP.md
3) docs/RUNBOOK.md
4) docs/AGENT_PLAYBOOK.md
5) docs/WORKLOG.md

Then do:
- Summarize current state in 6-10 bullets.
- Propose the next 1-2 tasks only (small scope).
- Implement directly after summary unless blocked.
- Keep docs updated at session end.
```

## Optional: Worker Dispatch Prompt

```text
You are Worker <FE|BE|DATA>.
Task ID: <id>
Goal: <single objective>
Allowed Write Scope:
- <paths>
Input Files:
- <paths>
Acceptance Criteria:
- <items>
Verification Commands:
- <commands>
Return only:
1) Files changed
2) What changed
3) Verification output
4) Risks
```

