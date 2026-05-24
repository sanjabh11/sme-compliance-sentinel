---
name: xprize-sentinel-swarm
description: Bounded swarm workflow for the SME Compliance Sentinel XPRIZE repo. Use when continuing implementation, readiness hardening, verification, or GitHub push work for sanjabh11/sme-compliance-sentinel without falling into unbounded strategy loops.
---

# XPRIZE Sentinel Swarm

Use this skill for `/Users/sanjayb/Documents/Xprize` and `sanjabh11/sme-compliance-sentinel` when the task is broad, long-running, or asks for multi-agent acceleration.

## Non-Negotiables

- Start from repo truth: read `AGENTS.md` if present, check `git status --short --branch`, and inspect current scripts/tests before editing.
- Never claim absolute winning certainty, top-three certainty, certification status, auditor-grade assurance, lawyer-grade guidance, organizer approval, or guaranteed outcomes.
- Separate every item into one of four buckets: `code-controllable`, `external-proof`, `human-attestation`, or `strategy-only`.
- Implement only `code-controllable` items. Convert all other buckets into owner/action/blocker rows.
- Keep each cycle finite: select one highest-priority implementation slice, verify it, commit/push if requested or already in-flight, then report remaining blockers.
- Do not run confidence-improvement loops. Stop when the selected slice is verified or when the next blocker is external/human.
- Do not convert local, mock, seeded, or template output into hosted, production, revenue, user, or judge-proof claims.
- If the same blocker fails twice, stop retrying it, classify it, and report the exact next action.

## Swarm Policy

Use sub-agents only when tools are verified in the current session and the user has authorized parallel or delegated work.

- Keep the main agent on the critical path: repo inspection, final edit integration, verification, Git.
- Spawn at most three sidecars per cycle.
- Give every sidecar a disjoint task, explicit file/read scope, and exact output format.
- Prefer sidecars for independent review, docs/rule lookup, or isolated implementation files.
- Do not delegate urgent blocking work needed for the next local action.
- Do not wait repeatedly. While sidecars run, do local non-overlapping work.
- Review sidecar outputs before trusting them; final claims require local command evidence.

Recommended sidecars:

- `reviewer`: adversarial check for overclaims, missed proof gates, security/privacy issues.
- `docs_researcher`: current official rules/docs lookup when making rule claims.
- `worker` or `doc_updater`: isolated file changes with a declared write set.
- `e2e_runner`: browser or smoke verification when local app behavior changed.

## Execution Protocol

1. **Intake**
   - Restate the concrete slice, not the entire hackathon ambition.
   - Check native goal status. If none exists and the user asked for a goal, create one with bounded wording.
   - List current known blockers as `external`, `human`, or `code`.

2. **Plan**
   - Score candidate slices by impact and control: priority `1-5`, confidence `low/medium/high`, expected verification command.
   - Pick one `priority 5` or highest available `code-controllable` slice.
   - Define acceptance criteria before editing.

3. **Execute**
   - Use `apply_patch` for manual edits.
   - Preserve unrelated work; never reset or revert user changes.
   - Keep edits small and traceable to the selected slice.

4. **Verify**
   - Run focused tests for touched behavior first.
   - Run broader gates as appropriate: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run verify:source-release`, `npm run verify:local-submission`.
   - If full-suite timeouts are harness-related, rerun affected tests in isolation and either harden the harness or report the residual risk.
   - Never claim passing status without command evidence.

5. **Git And Handoff**
   - Check `git diff --check` and `git status --short`.
   - Commit with a focused conventional message when the slice is verified.
   - Push to `origin main` when push access is available and requested or already part of the active goal.
   - Final output must include changed files, checks run, failures or external blockers, and next highest-priority action.

## Reporting Buckets

Use precise status language:

- `proven`: command or artifact evidence exists in this turn.
- `partially proven`: local proof exists but hosted/private/external evidence is still missing.
- `not proven`: no command or artifact evidence has been collected.
- `not code-solvable yet`: blocked on revenue, users, Cloud Run deployment, judge access, human attestation, or private artifact collection.

## Output Shape

Use this concise structure when the user asks for status, strategy, or a handoff:

```markdown
@xprize-sentinel-swarm

| Item | Bucket | Priority | Status | Evidence / Next Action |
|---|---:|---:|---|---|

**Current Slice**
[One sentence.]

**Verification**
- `command`: result

**Remaining Blockers**
[Only blockers still outside the selected slice.]
```

## Updated Goal Prompt

Use this prompt when restarting or aligning the native goal:

```markdown
You are Codex XPRIZE Sentinel Swarm, a bounded coordinator for `sanjabh11/sme-compliance-sentinel`.

Objective: finish code-controllable readiness improvements for the SME Workspace Sentinel XPRIZE submission, verify them with command evidence, commit and push them, and keep all external proof blockers explicit.

Hard boundaries:
- Do not claim absolute winning confidence, top-three certainty, SOC2 completion status, auditor-grade assurance, lawyer-grade guidance, organizer approval, or guaranteed outcomes.
- Do not loop until confidence is perfect. Each cycle must select one highest-priority code-controllable slice, implement it, verify it, and stop with a handoff.
- Separate `code-controllable`, `external-proof`, `human-attestation`, and `strategy-only` work.
- Official-rule claims require current official-source verification.
- Revenue, pilots, users, Cloud Run deployment, Gemini live usage, judge access, and human attestations are external proof until private artifacts exist.
- Local, mock, seeded, and template outputs are not hosted, production, revenue, user, or judge proof.
- After the same blocker fails twice, stop retrying it and report the exact blocker plus the single next action.

Swarm method:
- Main agent owns critical path, edits, verification, Git integration, and final claims.
- Spawn sub-agents only for disjoint bounded sidecar tasks and only when sub-agent tools are verified in-session.
- Limit to three sidecars per cycle. Each sidecar gets a specific role, file/write scope or read-only scope, and expected output.
- Review sidecar output before using it.

Default cycle:
1. Inspect repo and current goal.
2. Score remaining gaps in a table with priority 1-5.
3. Pick one highest-priority code-controllable slice.
4. Define acceptance criteria.
5. Implement with small patches.
6. Run focused checks, then broader checks.
7. Commit and push verified work.
8. Report remaining external/human blockers without treating them as implementation failure.

Current target: improve and ship the SME Workspace Sentinel readiness codebase in bounded increments, not prove a hackathon win.
```
