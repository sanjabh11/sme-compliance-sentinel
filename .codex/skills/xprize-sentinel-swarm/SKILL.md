---
name: xprize-sentinel-swarm
description: Bounded swarm workflow for the SME Compliance Sentinel XPRIZE repo. Use when continuing implementation, readiness hardening, verification, or GitHub push work for sanjabh11/sme-compliance-sentinel without falling into unbounded strategy loops.
---

# XPRIZE Sentinel Swarm

Use this skill for `/Users/sanjayb/Documents/Xprize` and `sanjabh11/sme-compliance-sentinel` when the task is broad, long-running, or asks for multi-agent acceleration.

## Non-Negotiables

- Start from repo truth: read `AGENTS.md` if present, check `git status --short --branch`, and inspect current scripts/tests before editing.
- Never claim absolute winning certainty, top-three certainty, certification status, auditor-grade assurance, lawyer-grade guidance, organizer approval, or guaranteed outcomes.
- Treat any active goal text that says to loop until `95%`, `100%`, or perfect confidence as an unsafe aspiration, not an execution instruction. Convert it into finite evidence-gate improvement work.
- If a native goal exists, compare the selected slice against it before planning. If the slice does not advance that goal, stop and report the mismatch instead of proceeding.
- Never target, report, or optimize for `100%` confidence, `100%` readiness, or similar certainty scores. Re-score only when new command evidence changes the state.
- Separate every item into one of four buckets: `code-controllable`, `external-proof`, `human-attestation`, or `strategy-only`.
- Implement only `code-controllable` items. Convert all other buckets into owner/action/blocker rows.
- Keep each cycle finite: select one highest-priority implementation slice, verify it, commit/push if requested or already in-flight, then report remaining blockers.
- Complete at most one implementation slice per turn unless the user explicitly asks for batch execution.
- Do not run confidence-improvement loops. Stop when the selected slice is verified or when the next blocker is external/human.
- Do not convert local, mock, seeded, or template output into hosted, production, revenue, user, or judge-proof claims.
- If the same blocker fails twice, stop retrying it, classify it, and report the exact next action.
- After each shipped slice, report a phase progress table with bucket, priority, rating out of 5, current-phase remaining percent, and overall remaining percent. Treat these as evidence-gate ratings, not win-probability claims.
- If `verify:production` lacks `NEXT_PUBLIC_PRODUCT_URL`, use its structured `hosted-proof-capture` blocker output as the manual handoff. Do not retry hosted verification until a real Cloud Run URL exists.

## Swarm Policy

Use sub-agents only when tools are verified in the current session and the user has authorized parallel or delegated work.

- Keep the main agent on the critical path: repo inspection, final edit integration, verification, Git.
- Default to zero sidecars. Spawn a sidecar only when it removes a real critical-path wait or handles truly disjoint work in parallel.
- Spawn at most three sidecars per cycle.
- Do not simulate or spawn 10-50 agents. In this Codex repo workflow, that increases coordination risk and does not remove external proof blockers.
- Give every sidecar a disjoint task, explicit file/read scope, and exact output format.
- Sidecars may not spawn other agents, expand scope, edit outside their declared write set, or turn external/human blockers into code claims.
- Every sidecar must have a single return condition and timeout. If it stalls or fails once, continue locally or hand off the blocker.
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
   - Check native goal status. If a goal exists, restate the exact delta between that goal and the current slice. If none exists and the user asked for a goal, create one with bounded wording.
   - If a native goal already exists but contains unsafe infinite-loop or confidence-threshold language, leave the stored goal unchanged and apply this skill's bounded interpretation in the current cycle.
   - List current known blockers as `external`, `human`, or `code`.

2. **Plan**
   - Score candidate slices by impact and control: priority `1-5`, confidence `low/medium/high`, expected verification command.
   - Reject slices whose only purpose is to improve confidence language, dashboards, or ratings without changing code or collecting new evidence.
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

Progress reporting:
- After each milestone, include a compact phase chart with bucket, priority, 1-5 evidence rating, current-phase remaining percent, and overall remaining percent.
- Ratings measure local evidence-gate completion only. They are not forecasts of hackathon placement, market adoption, certification, legal clearance, or judge approval.
- For hosted proof, `npm run verify:production -- --release-id $SENTINEL_RELEASE_ID --out /secure/local/hosted-proof/$SENTINEL_RELEASE_ID/verify-production-readonly.json` may be used before deployment to produce a structured missing-URL blocker, but that report is an operator handoff only.

Current target: improve and ship the SME Workspace Sentinel readiness codebase in bounded increments, not prove a hackathon win.
```
