# SME Workspace Sentinel

AI DLP and SOC2 readiness evidence for seed-stage teams using Google Workspace. This project is designed for the Build with Gemini XPRIZE under **Small Business Services**.

The product intentionally says **SOC2 readiness evidence**, not “SOC2 compliant” or “SOC2 certified.” SOC2 reports and attestations require qualified auditors; Sentinel only helps customers find Workspace risks, stage remediation, and export evidence.

## What It Implements

- Human-in-the-loop recommendation workflow for security remediation, with approver role assignment, SLA due dates, escalation targets, RBAC checks, and local notification queue.
- One-day paid pilot launch plan that turns the USP into a buyer offer, consent/OAuth/GCP checklist, scan/remediation/trust-proof timeline, objections, blockers, and next actions.
- Paid pilot prospect pipeline with high-fit targets, stage tracking, expected MRR, outreach sequences, conversion blockers, and claim-safe proof attachments.
- Paid Pilot Conversion Kit that selects the next high-fit prospect, generates claim-safe close assets, maps the consent/invoice/OAuth/scan/remediation/evidence steps, and blocks revenue claims until private proof exists.
- Pilot Consent & Scope Packet that spells out allowed Workspace sources, excluded data, requested/deferred OAuth scopes, AI data rules, HITL remediation rules, signature fields, and required private artifacts before live Workspace access.
- Hybrid scanner:
  - Tier 0 metadata filter skips low-risk changes.
  - Tier 1 deterministic/Sensitive Data Protection-style scanning detects PII and secrets.
  - Tier 2 Gemini semantic audit runs only when risk justifies cost and data exposure.
- Private Evidence Room with MRR, pilots, revenue/cost fields, risk counters, agent runs, testimonials, consent/related-party summaries, financial evidence ledger, redacted JSON/Markdown/CSV judge exports, and print-ready integrity-sealed HTML packet.
- Private Evidence Vault that tracks required invoices, payment exports, user logs, cost/CAC receipts, consent proof, Gemini/GCP/Workspace logs, product URL, repository URL, and demo-video artifacts by owner, redaction state, checksum, and proof status.
- Evidence Vault proof importer that converts redacted hosted verification JSON into checksummed Cloud Run, GCP persistence, Gemini, Workspace, Cloud Billing, repository, and readiness artifact records without storing raw tokens in the dashboard response.
- Evidence Intake Queue that prioritizes the private proof artifacts needed for the next paid pilot, gives accepted-proof examples, redaction checks, rejection triggers, and registration payloads for the Evidence Vault.
- Strategy Room with top feature bets, marketability/win/sellability scoring, proof-status labels, gap analysis, loophole register, and realistic win-confidence scoring.
- Trust Center Lite profile for redacted prospect-safe trust proof.
- Time-limited redacted Trust Packets with prospect alias, allowed sections, expiry, access logging, engagement analytics, and follow-up queue.
- Trust Center document vault with public/requestable/private visibility, NDA-aware access requests, approval/denial audit logs, and approved document summaries in packets.
- Security Questionnaire Assistant that drafts review answers, imports text/CSV/TSV/spreadsheet-text/PDF-text questionnaires, tracks answer approval state, stores approved answers in a reusable answer library, enforces review cadence, tracks customer-segment history, supports bulk library verification, and exports customer-specific response packs.
- Readiness Command Center with OAuth readiness, sync reliability, pilot CRM, risk/deal scoring, AI budgets, Cloud Billing cost controls, compliance copy guardrails, framework coverage, evidence-calibrated ROI, playbooks, and judge narrative.
- Risk/deal/evidence maturity score history with deltas, trend narrative, milestone checklist, and a manual capture endpoint.
- Redacted Deal Impact Report that combines risk-score movement, ROI, Trust Packet engagement, questionnaire progress, remediation proof, and production gaps.
- Tenant-editable remediation playbooks with staged actions, owner roles, SLA targets, escalation routes, pause state, and safe-auto enforcement.
- Approval Operations surface with role directory, RBAC decisions, queued in-app approval notices, and production delivery gaps for email/Google Chat/ticketing.
- Cloud Cost Controls plan for Cloud Billing budgets, Pub/Sub spend alerts, Gemini API key restrictions, quota runbooks, and private judge evidence.
- Production Launch Command Center that unifies Cloud Run/GCP persistence, live Gemini, Workspace OAuth/sync, paid pilot proof, judge access, license/IP review, environment readiness, verification commands, and private proof artifacts.
- Production Provisioning Pack that generates non-secret Google Cloud setup commands, API enablement, service-account/IAM steps, Secret Manager names, Cloud Run dry-run/deploy commands, verification sequence, and private-handling rules.
- Hosted Evidence Capture Packet that turns the deployed Cloud Run URL, Gemini, GCP persistence, Workspace sync, Cloud Billing, paid-pilot, judge-access, and demo-video proof into a private artifact checklist without treating local/mock output as production proof.
- Release Deployment Evidence Packet that binds release id, source repository, Cloud Run manifest state, hosted verification commands, redaction rules, private storage paths, and an Evidence Vault import template for the final judge packet.
- Private Deployment Runbook that turns the release packet into stop-gated operator phases with exact command ids, proof files, redaction checks, and external-proof boundaries.
- Hosted Proof Bundle Collector that captures redacted hosted JSON from production verification, deployment, judge access, source release, license/IP review, hosted evidence, Devpost, demo video, Workspace sync status, claim guard, and evidence-intake surfaces into an ignored local evidence folder with a release-level proof manifest.
- Hosted Proof Import CLI that dry-runs or posts only the redacted hosted `verify-production.json` bundle into the private Evidence Vault, reads admin tokens only from environment variables, and rejects local/non-HTTPS imports unless explicitly marked as a local smoke test.
- Private Cloud Run Manifest Renderer that turns non-secret production values into an ignored rendered manifest, verifier JSON, and dry-run/deploy command files while rejecting raw secrets, refresh tokens, service-account key paths, and judge credentials.
- Cloud Run Dry-Run Preflight Packet that validates a filled private render-values file, writes a redaction checklist, and stops operators before `gcloud run services replace --dry-run` if placeholders or verifier blockers remain.
- Production Gemini Proof Smoke that runs a synthetic, non-customer high-risk fixture through the deployed Gemini audit path and blocks readiness unless `provider=gemini-api` is recorded.
- Market Positioning Command Center with competitor battlecards for Vanta, Drata, and Secureframe, narrow USP scoring, differentiators, parity gaps, buyer narrative, and proof actions.
- Framework Evidence Packs for SOC2, ISO 27001, GDPR, HIPAA, and PCI with control-level status, production-proof gaps, owner roles, redacted markdown export, and judge/prospect/auditor audience templates.
- Private pilot evidence workflow for recording arms-length status, related-party risk, MRR, active users, proof status, consent state, missing/private/verified financial proof, and required private artifact slots.
- Production persistence contract and verifier for tenant-scoped Firestore documents, one-time OAuth launch states, append-only BigQuery audit rows, and Secret Manager OAuth-token storage.
- Workspace sync reliability control plane with OAuth install proof, authenticated webhook intake that treats production pushes as reconciliation hints, Drive start/page token plans, Drive changes watch renewal state, Gmail watch historyId state, a guarded renewal endpoint, and gates that do not claim live sync until both Drive and Gmail cursors are initialized.
- Live Workspace sync bootstrap endpoint that, after consented OAuth and GCP persistence are configured, reads the refresh-token payload from Secret Manager, exchanges it for a short-lived access token, initializes Drive changes and Gmail watches, persists cursor state to Firestore, and redacts all token values from the response.
- Claim Guard scanner that checks product, docs, and submission copy for overclaims such as certification, guaranteed compliance, audit assurance, or absolute win claims.
- Submission Compliance Gate plus dependency/license manifest for new-project disclosure, repository access, judge access, third-party license/API review, demo-video asset clearance, customer redaction, and two-business-day evidence response readiness.
- Project Provenance Report that checks Git history, first-commit timing, tracked/untracked source state, repository URL, human attestation, and pre-existing framework/dependency disclosure.
- Source Release Guard that checks required source surfaces, `.gitignore` coverage, release file plan, and obvious secret patterns before the first commit or judge-facing source push.
- XPRIZE Submission Gate that blocks readiness until current evidence satisfies production Google Cloud, Gemini, real revenue/user proof, consent, product URL, repository URL, and demo-video requirements.
- Judge Access Pack that prepares non-secret testing instructions, signed-out smoke commands, private credential rules, safe walkthrough steps, and evidence-response owners without committing judge credentials.
- Private XPRIZE Submission Binder that maps every gate item to an artifact owner, status, testing instruction, demo-timeline step, private evidence queue, and final pre-submit checklist.
- Devpost Submission Pack that generates claim-safe public copy, Google stack wording, under-three-minute demo script, screenshot checklist, testing instructions draft, and private judge evidence response plan.
- Demo Video Compliance Pack that turns the script into runtime, public-platform, English/subtitle, live-Gemini, asset-clearance, and customer-redaction gates before recording or upload.
- Mock Drive/Gmail event flow for local demos before OAuth credentials are ready.
- Production adapters for Gemini API and Google Sensitive Data Protection through environment variables.

## Local Setup

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open `http://127.0.0.1:3000`.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Demo Flow

1. Run **Build launch plan** to see the one-day paid pilot offer, required proof, owners, day-one workflow, and blockers.
2. Run **Check prospect pipeline** to see high-fit prospects, expected pipeline MRR, outreach proof attachments, and conversion blockers.
3. Run **Build conversion kit** to select the best prospect, generate the founder email/proposal/consent/invoice proof checklist, and expose the exact private artifacts still missing before revenue can count.
4. Run **Build consent packet** to confirm allowed sources, excluded data, requested/deferred scopes, AI data rules, remediation approvals, and signature fields before OAuth access.
5. Click **High-risk Drive event**.
6. The app ingests a mock Workspace event.
7. Tier 1 detection finds PII/secrets.
8. Gemini semantic audit creates a staged recommendation with approver role, SLA, and escalation metadata.
9. Click **Approve**.
10. Click **Remediate**.
11. Generate the redacted judge export in the Evidence Room, then generate Markdown, CSV, and sealed print-ready packets for customer/judge review.
12. Record a private pilot evidence item and confirm MRR/readiness metrics refresh without exposing customer names in the judge packet.
13. Request NDA-gated Trust Center documents, approve the request, and create a Trust Packet that includes only public and approved requestable document summaries.
14. Create a redacted Trust Packet and verify it has an expiry, limited sections, no customer security findings, and Trust Analytics follow-up guidance.
15. Build a questionnaire response pack from pasted text or CSV/TSV/spreadsheet/PDF-extracted text, approve an answer, and export the pack.
16. Build the same questionnaire again to show an approved-answer library hit, then verify one reusable answer or bulk-verify the selected segment before its review date.
17. Export a framework evidence pack for SOC2, ISO 27001, GDPR, HIPAA, or PCI; switch between judge, prospect, and auditor templates; and confirm blocked/partial controls are not hidden where the audience needs them.
18. Create or edit a remediation playbook and confirm mutating actions remain staged unless tenant safe-auto policy explicitly permits them.
19. Inject a high-risk event and confirm Approval Operations shows the RBAC decision, queued local notice, and production delivery gaps.
20. Capture a score snapshot after scan/remediation/pilot changes and confirm the trend panel shows risk, deal-impact, evidence, and MRR deltas, then confirm the ROI card updates from pilot MRR, remediation, questionnaire, trust packet, and score-history evidence.
21. Generate a Deal Impact Report and confirm it summarizes buyer proof points, score movement, ROI, and remaining production gaps without claiming a guaranteed outcome.
22. Run **Reconcile sync cursors** to show the Drive/Gmail cursor path. In mock mode this advances simulated cursors without calling Google APIs; in live mode it blocks until OAuth connection state, Drive startPageToken, and Gmail historyId exist.
23. Run **Bootstrap live sync** after consented OAuth, GCP persistence, product URL, Gmail topic, and Drive channel token are configured; it initializes Drive/Gmail watches and persists cursor state without returning token values.
24. Run **Check cost controls** to show the Cloud Billing budget/API-key restriction plan and the production blockers that still need GCP proof.
25. Run **Launch proof plan** to unify deployment, live Gemini, Workspace sync, paid pilot evidence, judge access, license/IP review, env gaps, verification commands, and proof artifacts.
26. Run **Provisioning pack** to generate the non-secret Cloud Run/GCP setup sequence, Secret Manager checklist, dry-run command, deploy command, and hosted verification sequence.
27. Run **Cloud Run evidence** or `npm run verify:cloudrun-deployment` to confirm the checked-in manifest still has only template replacement gaps, Secret Manager references, and manual attestation flags. Start from `docs/deployment/cloudrun-render-values.template.json` or run `npm run write:cloudrun-values-template -- /secure/local/cloudrun-render-values.json`, fill the private copy with production values, then run `npm run render:cloudrun-manifest -- --values /secure/local/cloudrun-render-values.json --out-dir artifacts/deployment --release-id $SENTINEL_RELEASE_ID --strict` before a real dry-run.
28. Run **Hosted evidence** to see the private capture packet for hosted Cloud Run URL, production verification JSON, live Gemini, GCP persistence, Workspace sync, Cloud Billing, paid-pilot, and judge-access artifacts.
29. Run **Release packet** to bind release id, source repository, Cloud Run revision evidence, hosted verification commands, Evidence Vault import template, and redaction checklist into one private judge-packet plan.
30. Run `npm run collect:hosted-proof -- --url $NEXT_PUBLIC_PRODUCT_URL --release-id $SENTINEL_RELEASE_ID` after deployment to capture an ignored local bundle of redacted hosted proof JSON, `release-evidence-manifest.json`, and release-integrity checks. Then run `npm run import:hosted-proof -- --bundle-dir artifacts/hosted-proof/$SENTINEL_RELEASE_ID --url $NEXT_PUBLIC_PRODUCT_URL --dry-run` to preview the Evidence Vault import request; the importer rejects missing or mismatched release ids, hosted URLs, deployment-packet metadata, or failed release-integrity status before posting.
31. Run **Gemini proof smoke** after deploying with `GEMINI_API_KEY` to verify the hosted app records `provider=gemini-api` using a synthetic non-customer fixture.
32. Run **Claim Guard** to verify that product and submission copy does not claim certification, legal advice, audit assurance, guaranteed compliance, or certainty of winning.
33. Run **Check financial evidence** to confirm mock rows, missing invoices, private judge proof, and verified production proof stay separated.
34. Run **Check Evidence Vault** to confirm invoices, user logs, cost/CAC receipts, consent records, Gemini/GCP logs, hosted URL, repository URL, and demo-video proof are tracked privately with redaction state.
35. Paste redacted `verify:production`, hosted evidence, Gemini, persistence, Workspace bootstrap, Cloud Run, or cost-control JSON into **Import proof JSON** to register checksummed private artifact records without manual transcription.
36. Run **Build intake queue** to prioritize private proof collection, redaction work, accepted proof types, rejection triggers, and Evidence Vault registration payloads for the next paid pilot.
37. Run **Check submission gate** to see which XPRIZE requirements are proven, warning, or blocked.
38. Run **Project provenance** to verify Git history, tracked source, first commit timing, repository URL, and pre-existing-work disclosure gaps.
39. Run **Source release** before the first commit or source push to verify required files, ignore rules, release plan, and obvious secret patterns.
40. Run **Check submission compliance** to surface repository, IP/license, public video, customer-redaction, and evidence-response blockers.
41. Run **License manifest** to export dependency, license, and Google API-use disclosure details.
42. Run **Judge access pack** to prepare non-secret testing instructions, signed-out smoke checks, safe walkthrough, private credential rules, free-access confirmation, and evidence-response owners.
43. Run **Generate submission binder** to produce the private judge-readiness manifest, testing-instruction status, under-three-minute demo timeline, and two-business-day evidence request queue.
44. Run **Devpost pack** to generate claim-safe submission copy, demo scenes, screenshot targets, testing instructions, and the private evidence response plan.
45. Run **Demo video pack** to verify the generated timeline, public host, English/subtitle confirmation, asset clearance, redaction, functioning-product footage, and live Gemini proof gates before recording or upload.
46. Run **Market battlecard** to compare Sentinel against Vanta, Drata, and Secureframe while keeping the one-day Workspace risk-scan wedge explicit.

The **Low-risk skip** button verifies that metadata-only events do not call Gemini.

## Required Environment Variables

- `GEMINI_API_KEY`: required in production for the deployed LLM workflow.
- `GEMINI_MODEL`: defaults to `gemini-3.5-flash`; verify current model availability and project access before final deployment.
- `SENTINEL_GEMINI_MODEL_ALLOWLIST`: comma-separated model allowlist enforced before any Gemini call.
- `SENTINEL_GEMINI_MONTHLY_BUDGET_USD`: tenant budget guardrail; scans fall back to deterministic findings instead of calling Gemini if projected spend exceeds this amount.
- `SENTINEL_GEMINI_MAX_CONTENT_BYTES_PER_EVENT`: maximum content bytes sampled into one Gemini risk prompt.
- `GOOGLE_CLOUD_PROJECT`: Google Cloud project for production deployment.
- `GOOGLE_CLOUD_PROJECT_NUMBER`: numeric project id required for API Keys API verification.
- `GOOGLE_CLOUD_BILLING_ACCOUNT_ID`: billing account id used for Cloud Billing budget setup and private cost evidence.
- `SENTINEL_GCP_BUDGET_ID`: configured Cloud Billing budget id after the production budget is created.
- `SENTINEL_BUDGET_PUBSUB_TOPIC`: Pub/Sub topic for programmatic budget alerts.
- `SENTINEL_CLOUD_COST_CONTROLS_MODE`: keep `plan` locally; set `production` only when budget, key, and quota evidence should be verified against GCP.
- `SENTINEL_CLOUD_RUN_SERVICE_NAME` / `SENTINEL_CLOUD_RUN_REGION`: Cloud Run identity used by deployment, describe, and evidence-capture commands.
- `SENTINEL_RELEASE_ID`: non-secret release identifier that ties Cloud Run revision proof, source commit, verification JSON, and Evidence Vault imports together.
- `SENTINEL_SOURCE_COMMIT`, `SENTINEL_SOURCE_COMMIT_AT`, `SENTINEL_SOURCE_BRANCH`: non-secret source revision metadata rendered into Cloud Run so the hosted provenance endpoint can identify the deployed source commit even when `.git` is not present in the container image.
- `SENTINEL_PRIVATE_EVIDENCE_BUCKET`: private bucket or equivalent store for redacted hosted verification JSON, Cloud Run proof, screenshots, invoices, and judge packet artifacts.
- `SENTINEL_ADMIN_ACTION_TOKEN`: Secret Manager-backed token required for production proof imports and write-through proof endpoints. Send it only through private operator tooling, for example the `x-sentinel-admin-token` header.
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`: required before `/api/oauth/google/start?dryRun=false` can redirect pilot users through Google Workspace OAuth.
- `WORKSPACE_GMAIL_TOPIC`: fully qualified Pub/Sub topic name for Gmail watch notifications, for example `projects/PROJECT_ID/topics/workspace-gmail-updates`.
- `WORKSPACE_GMAIL_SUBSCRIPTION`: exact Pub/Sub push subscription name expected by the Gmail webhook, for example `projects/PROJECT_ID/subscriptions/workspace-gmail-push`.
- `SENTINEL_WORKSPACE_WEBHOOK_AUTH_MODE`: keep `demo` locally; set `oidc` in production so non-demo Workspace webhook pushes require authentication.
- `WORKSPACE_PUBSUB_PUSH_AUDIENCE`: expected audience claim for authenticated Pub/Sub push OIDC tokens.
- `WORKSPACE_PUBSUB_SERVICE_ACCOUNT_EMAIL`: service account email expected in authenticated Pub/Sub push OIDC tokens.
- `WORKSPACE_DRIVE_CHANNEL_TOKEN`: opaque token used to validate direct Google Drive push channel headers. Do not commit the production value.
- `SENTINEL_STORAGE_MODE`: use `memory` locally; use `gcp-rest` only after Google Cloud project, Firestore, BigQuery, Secret Manager, and IAM are configured.
- `SENTINEL_EVIDENCE_SIGNING_SECRET`: optional production HMAC secret for sealed evidence packets. Leave empty locally; do not commit the secret value.
- `FIRESTORE_DATABASE`: Firestore database id, usually `(default)`.
- `BIGQUERY_DATASET` / `BIGQUERY_AUDIT_TABLE` / `BIGQUERY_AGENT_RUNS_TABLE`: append-only audit and agent-run evidence targets.
- `WORKSPACE_SECRET_PREFIX`: Secret Manager prefix for per-tenant Workspace OAuth refresh tokens.
- `SENSITIVE_DATA_PROTECTION_ENABLED`: set to `true` when enabling the Google Sensitive Data Protection REST adapter.
- `SENTINEL_EVIDENCE_MODE`: keep `mock` locally; set `production` only after mock pilot records have been replaced with real customer, revenue, cost, and consent evidence.
- `NEXT_PUBLIC_PRODUCT_URL`: hosted product URL for judge access. A URL alone is not marked ready until `XPRIZE_JUDGE_ACCESS_CONFIGURED` and `XPRIZE_FREE_JUDGE_ACCESS_THROUGH_JUDGING_CONFIRMED` are also true.
- `XPRIZE_REPOSITORY_URL`: public or judge-shared source repository URL.
- `XPRIZE_CATEGORY`: selected submission category; keep `Small Business Services` unless the final strategy is formally changed.
- `XPRIZE_DEMO_VIDEO_URL`: public under-three-minute demo video URL.
- `XPRIZE_DEMO_VIDEO_UNDER_3_MIN_CONFIRMED`: set to `true` only after the final public video duration is verified under three minutes.
- `XPRIZE_DEMO_VIDEO_PUBLICLY_ACCESSIBLE_CONFIRMED`: set to `true` only after the final video is public on an accepted video platform.
- `XPRIZE_DEMO_VIDEO_ASSET_CLEARANCE_CONFIRMED`: set to `true` only after confirming screenshots, marks, music, and other video assets are owned or permitted.
- `XPRIZE_DEMO_VIDEO_CUSTOMER_DATA_REDACTED_CONFIRMED`: set to `true` only after confirming the public video contains no customer-identifying security data.
- `XPRIZE_DEMO_VIDEO_ENGLISH_OR_SUBTITLED_CONFIRMED`: set to `true` only after confirming the final public video is in English or includes English subtitles.
- `XPRIZE_JUDGE_ACCESS_CONFIGURED`: set to `true` only after hosted judge test access is ready and documented outside the repository.
- `XPRIZE_THIRD_PARTY_REVIEW_APPROVED`: set to `true` only after dependency licenses, Google API terms, and third-party usage are reviewed for final submission.
- `XPRIZE_PROJECT_CREATED_AFTER_START_CONFIRMED`: set to `true` only after repository history confirms the project was created after the hackathon start date and pre-existing work is disclosed.
- `XPRIZE_ENTRANT_TYPE`: set to `individual`, `team`, or `organization` only after confirming the final Devpost entrant type.
- `XPRIZE_GENERAL_ELIGIBILITY_CONFIRMED`: set to `true` only after human review confirms entrant eligibility, authority/age, jurisdiction, and rule compliance.
- `XPRIZE_REPRESENTATIVE_AUTHORIZED`: set to `true` only after confirming the representative can submit for a team or organization.
- `XPRIZE_ORGANIZATION_UNDER_25_CONFIRMED`: set to `true` only if entering as an organization and the small-organization employee-count condition is privately verified.
- `XPRIZE_CORPORATE_ID_CONFIGURED`: set to `true` only if entering as an organization and the required corporate ID proof is ready in the private submission packet.
- `XPRIZE_NO_PROMOTION_ENTITY_CONFLICT_CONFIRMED`: set to `true` only after confirming no disallowed promotion-entity employee/contractor/immediate-family conflict applies.
- `XPRIZE_FREE_JUDGE_ACCESS_THROUGH_JUDGING_CONFIRMED`: set to `true` only after confirming the hosted product will remain free and accessible for judges through the judging period.
- `XPRIZE_TESTING_INSTRUCTIONS`: non-secret testing instruction summary; keep real credentials in Devpost private fields.
- `XPRIZE_TOTAL_REVENUE_EVIDENCE_CONFIGURED` / `XPRIZE_REVENUE_BY_MONTH_EVIDENCE_CONFIGURED`: set to `true` only after private arms-length invoice/payment evidence and month-by-month revenue evidence are ready.
- `XPRIZE_TOTAL_COSTS_EVIDENCE_CONFIGURED` / `XPRIZE_CAC_SPEND_EVIDENCE_CONFIGURED`: set to `true` only after private cost records and customer acquisition spend evidence are ready, even if CAC is zero.
- `XPRIZE_REAL_USER_EVIDENCE_CONFIGURED` / `XPRIZE_TESTIMONIAL_CONSENT_CONFIRMED`: set to `true` only after active-user evidence, user breakdowns, and explicit feedback-sharing consent exist.
- `XPRIZE_RELATED_PARTY_REVENUE_REVIEWED`: set to `true` only after related-party customer relationships are reviewed and separated from arms-length revenue.
- `XPRIZE_PRODUCT_RUNNING_EVIDENCE_CONFIGURED` / `XPRIZE_AGENT_EXECUTION_LOGS_CONFIGURED`: set to `true` only after hosted product-running proof and redacted Gemini/agent execution logs are captured.
- `SENTINEL_GEMINI_API_KEY_ID`: API Keys API resource id for the server-side Gemini key; do not put the secret key here.
- `SENTINEL_GEMINI_API_ALLOWED_SERVER_IPS`: comma-separated static egress IP allowlist for server key restrictions.
- `SENTINEL_GEMINI_DAILY_REQUEST_QUOTA` / `SENTINEL_GEMINI_DAILY_TOKEN_QUOTA`: documented quota targets for the production runbook.
- `SENTINEL_GEMINI_QUOTA_EVIDENCE_CONFIRMED`: set to `true` only after private Gemini quota or usage-limit proof is captured; keep `false` in templates.

## Google Cloud Production Path

The intended production deployment uses:

- Cloud Run for the Next.js app and webhook receiver.
- Pub/Sub for Workspace event notifications.
- Firestore or a durable database for tenants, findings, approvals, and audit state.
- BigQuery for append-only evidence analytics.
- Secret Manager for per-tenant OAuth tokens.
- Sensitive Data Protection for PII/secrets detection.
- Gemini API for semantic risk classification and evidence summaries.

The checked-in `cloudrun.service.yaml` is a deployment template, not a proof artifact by itself. Before applying it, replace `PROJECT_ID`, `PROJECT_NUMBER`, `RELEASE_ID`, service URLs, private evidence bucket, billing ids, OAuth ids, Pub/Sub resources, and XPRIZE placeholders with the final production values. Keep human-attestation flags such as demo-video clearance, judge access, eligibility, and third-party review set to `false` until the private proof exists. The manifest references these Secret Manager secrets by lookup name, maps each lookup through the `run.googleapis.com/secrets` annotation, and never stores secret values in source:

- `sentinel-admin-action-token`
- `gemini-api-key`
- `google-oauth-client-secret`
- `sentinel-evidence-signing-secret`
- `workspace-drive-channel-token`

Do not set `GOOGLE_CLOUD_ACCESS_TOKEN` in Cloud Run. The deployed service should use its configured service account and metadata-server credentials for Google Cloud REST calls.

Cloud Run secret env vars are pinned to Secret Manager version `1` in the template. After rotating any secret, update the referenced version in the rendered manifest and deploy a new revision instead of relying on `latest`. For Cloud Run YAML, every `secretKeyRef.name` must also have a matching `run.googleapis.com/secrets` annotation entry pointing at `projects/PROJECT_NUMBER/secrets/SECRET_NAME`; the private renderer fills the project number before dry-run.

`GET /api/production/provisioning` returns the non-secret provisioning pack for operators: required Google APIs, service accounts, IAM roles, Secret Manager names, private evidence bucket setup, Artifact Registry build command, Pub/Sub setup, Cloud Run dry-run/deploy commands, and post-deploy verification sequence. The pack builds the container with the configured Cloud Run region and a tag derived from `SENTINEL_RELEASE_ID`, not `latest`, so source, image, manifest, and revision evidence can be tied to one release. The pack intentionally marks human attestations as manual review and never includes admin tokens, API key values, OAuth client secrets, evidence-signing secrets, Drive channel tokens, judge credentials, invoices, or customer findings.

`GET /api/production/deployment-evidence` and `npm run verify:cloudrun-deployment` validate the Cloud Run manifest before an operator applies it. The verifier reports whether the manifest is still `template-needs-values`, `ready-to-dry-run`, or `blocked`; lists placeholder replacements, manual XPRIZE attestation flags, pinned Secret Manager references, Cloud Run secret annotation lookups, dry-run/deploy commands, and post-deploy verification commands; and blocks raw secret values, missing YAML secret annotations, mismatched secret resources, `latest` secret references, mutable `latest` container tags, or rendered image tags that do not match `SENTINEL_RELEASE_ID`. A `ready-to-dry-run` result is only local deployment-template evidence, not hosted Cloud Run proof.

`GET /api/production/hosted-evidence` returns the private hosted evidence capture packet. It summarizes the current product URL, evidence mode, storage mode, Cloud Run manifest state, live Gemini proof, GCP persistence proof, Workspace OAuth/sync proof, Cloud Billing controls, paid-pilot proof, demo-video proof, and Evidence Vault redaction state. Local memory, mock Gemini, template manifests, and seeded pilots are marked `mock-only` or `missing`; the packet only moves toward `ready-to-capture` after hosted Cloud Run, production evidence mode, GCP persistence, live Gemini, and private artifact registration are in place. The packet also lists exact capture commands and accepted proof templates for the private judge packet.

`GET /api/production/deployment-packet` returns the release deployment evidence packet. It binds `SENTINEL_RELEASE_ID`, `NEXT_PUBLIC_PRODUCT_URL`, source repository URL, private evidence bucket, Cloud Run manifest status, local quality gates, dry-run/deploy/describe commands, hosted `verify:production` commands, hosted evidence capture, Evidence Vault import response, source-release/provenance reports, redaction rules, and an import-template payload into one operator plan. It also includes a private deployment runbook with five stop-gated phases: local preflight, manifest render, Cloud Run dry-run/deploy, hosted production proof, and redacted Evidence Vault import. Each phase lists command ids, required proof files, stop conditions, and redaction checks. It remains `template-needs-values` until release id, product URL, private evidence bucket, admin-token secret, and rendered Cloud Run placeholders are ready; it remains only a plan until the hosted commands are actually executed and checksummed artifacts are registered.

The current runtime still uses in-memory state for the local MVP demo. The app now exposes the production persistence contract through the Readiness Command Center and `/api/production/persistence`: tenant state and one-time OAuth launch states belong under `tenants/{tenantId}` in Firestore, audit evidence belongs in BigQuery with a `tenant_id` column plus `sequence`, `previous_hash`, `event_hash`, and `audit_chain_version` fields, agent-run evidence belongs in a separate BigQuery table with `provider`, `model`, fallback, token-estimate, and cost fields, and Workspace OAuth refresh tokens belong in Secret Manager. The persistence endpoint returns both BigQuery table schema plans, sample `insertAll` payloads, the Secret Manager token path, and a safe `versions/latest:access` request plan so operators can provision and verify every target before onboarding pilots. `POST /api/production/persistence` attempts write-through verification only when `SENTINEL_STORAGE_MODE=gcp-rest` is configured; in local memory mode it returns a blocked result instead of a false pass. The Secret Manager check reads only the response status and never returns token values; if no token secret exists yet, the verifier is blocked until a consent-gated OAuth callback stores a real refresh-token payload. Agent-run rows store redacted summaries only, not raw prompts, raw document content, or customer secrets; production XPRIZE evidence still requires a persisted run with `provider=gemini-api`. Before onboarding real customers, deploy on Cloud Run with the required service-account IAM roles and verify write-through persistence.

## AI Cost And Model Guardrails

Before Tier 2 runs, Sentinel enforces the configured Gemini model allowlist, monthly budget, and per-event content byte cap. If the gate blocks a call, deterministic DLP still creates a staged recommendation for human review, but `bytesRoutedToGemini` remains zero and the audit log records a deterministic provider. Local regex findings stay labeled as `tier1_deterministic`; `tier1_sdp` appears only when the Google Sensitive Data Protection adapter is enabled, configured, and actually attempted. If Gemini is unavailable or no API key is configured, mock-mode runs are explicitly labeled with a fallback reason such as `api-key-missing` or `api-call-failed`; production evidence requires `provider=gemini-api`. This keeps SME pilot costs bounded, avoids silently dropping high-risk findings, and prevents mock Gemini or local detector evidence from being mistaken for live Google API proof.

`GET /api/production/gemini-smoke` reports whether current evidence includes a live `provider=gemini-api` run. `POST /api/production/gemini-smoke` runs a synthetic, non-customer fixture through the same hybrid scanner and Gemini classifier path. If `GEMINI_API_KEY` is absent or the Gemini call fails, the result is `mock-only` and must not be counted as deployed Gemini proof. A passing result still needs durable BigQuery agent-run persistence before final submission.

`GET /api/production/cost-controls` returns the production Cloud Cost Controls plan: Cloud Billing budget request body, alert thresholds, Pub/Sub spend-response topic, Gemini API key restriction patch, quota runbook, and missing evidence checklist. `POST /api/production/cost-controls` verifies the configured Cloud Billing budget and API key resources only when `SENTINEL_CLOUD_COST_CONTROLS_MODE=production` and the required GCP identifiers are configured. It reads the API key resource and fails unless the key is restricted to the Generative Language API plus the configured server IP allowlist. Local plan mode returns a blocked result instead of treating internal cost estimates as production GCP proof, and quota proof stays blocked until `SENTINEL_GEMINI_QUOTA_EVIDENCE_CONFIRMED=true` is set from private evidence.

`GET /api/production/launch-readiness` returns the operator checklist for moving from local demo to judge-ready production. It consolidates Cloud Run/GCP persistence, live Gemini proof, Workspace OAuth/sync, paid pilot evidence, judge access/media, license/IP review, final gates, environment variables, verification commands, proof artifacts, blockers, and private-handling rules. It stays blocked in local/mock mode and is intended to guide the final production run, not to substitute for real Cloud Run, Gemini, Workspace, revenue, user, or customer-consent evidence.

After deployment, run `npm run verify:production -- --url https://YOUR-CLOUD-RUN-URL` to generate a JSON readiness smoke report across the hosted readiness, launch, deployment packet, hosted evidence, judge access, submission, compliance, Devpost, license, and Claim Guard endpoints. The command is read-only by default. Add `--include-write-checks` only after production service-account credentials, `SENTINEL_ADMIN_ACTION_TOKEN`, and private evidence handling are configured; that mode also calls Gemini smoke, persistence, cost-control, Workspace reconciliation, and Workspace bootstrap verifier endpoints using the private admin-token header. Add `--strict` when you want the command to exit non-zero for any blocked or needs-review status. Use `--admin-token-env CUSTOM_ENV_NAME` only if the private shell stores the token under a different environment variable.

Run `npm run verify:cloudrun-deployment` before any Cloud Run dry-run. The verifier requires the checked-in manifest to keep secret values in Secret Manager references with explicit numeric versions and blocks duplicate env names, raw secret-shaped values in any env field, prohibited credential env vars such as `GOOGLE_CLOUD_ACCESS_TOKEN`, `GOOGLE_APPLICATION_CREDENTIALS`, Workspace refresh tokens, and judge passwords, invalid production mode flags, non-HTTPS product/OAuth/PubSub URLs, non-YouTube/Vimeo/Youku demo-video hosts, invalid `XPRIZE_ENTRANT_TYPE`, malformed Google OAuth client ids, wildcard or invalid Gemini server IP allowlists, non-positive Gemini budget/quota/cost values, mismatched OAuth redirect or Pub/Sub audience paths, project/billing/resource mismatches, category drift away from Small Business Services, and a `GEMINI_MODEL` outside `SENTINEL_GEMINI_MODEL_ALLOWLIST`; unreviewed revenue, cost, CAC, user, testimonial-consent, related-party, product-running, agent-log, and quota-evidence flags stay in manual review. Cloud Run production should use the configured runtime service account plus IAM, while local REST smoke tests may still use `GOOGLE_CLOUD_ACCESS_TOKEN` from a private shell.

Run `npm run write:cloudrun-values-template -- /secure/local/cloudrun-render-values.json` to create a private starting file from the tracked non-secret template at `docs/deployment/cloudrun-render-values.template.json`. Fill only non-secret production values: project id, project number, release id, source commit metadata, product URL, billing budget id or short id, OAuth client id, Gemini API key resource id or short id, static egress IPs, entrant type, category, reviewed business-evidence flags, and numeric Secret Manager versions. Then run `npm run render:cloudrun-manifest -- --values /secure/local/cloudrun-render-values.json --out-dir artifacts/deployment --release-id RELEASE_ID --strict` to create an ignored private render bundle under `artifacts/deployment/RELEASE_ID/`. Strict mode now fails before rendering when required values are absent or still placeholder-shaped. The renderer writes `cloudrun.service.rendered.yaml`, `cloudrun-manifest-verifier.json`, `cloudrun-render-summary.json`, and dry-run/deploy command files; it replaces the Cloud Run secret annotation project-number placeholders and rejects raw API keys, OAuth secrets, refresh tokens, service-account key paths, access tokens, and judge credentials. A `ready-to-dry-run` render is still private deployment-template evidence, not hosted proof.

Run `npm run prepare:cloudrun-dry-run -- --values /secure/local/cloudrun-render-values.json --out-dir artifacts/deployment --release-id RELEASE_ID --strict` immediately before the real Cloud Run dry-run. The preflight command re-renders the private manifest, reruns the verifier, writes `cloudrun-dry-run-preflight-packet.json` and `.md` beside the rendered manifest, and exits non-zero in strict mode unless the packet status is `ready-to-dry-run`. The packet lists stop conditions, files to preserve, manual-review evidence flags, and redaction checks for Cloud Run dry-run/deploy output. It does not deploy Cloud Run or prove hosted readiness.

Run `npm run collect:hosted-proof -- --url https://YOUR-CLOUD-RUN-URL --release-id RELEASE_ID` to write a local hosted proof bundle under `artifacts/hosted-proof/RELEASE_ID/`. The bundle includes `verify-production.json`, deployment packet, hosted evidence, judge access pack, source-release guard, project provenance, license manifest, submission binder, Devpost pack, demo-video pack, evidence-intake queue, Workspace sync status, Claim Guard report, `release-evidence-manifest.json`, `manifest.json`, and a Markdown summary. The collector records release-integrity checks so `verify-production.json`, the deployment packet, the Evidence Vault import template, hosted URL, and pushed-source provenance all point at the same release before import. The release manifest groups Cloud Run, production readiness, live Gemini, GCP persistence, Workspace watch lifecycle, cost controls, business proof, judge access, demo video, repository, license/IP, and Devpost/claim-safety slots as verified, needs-review, missing, mock-only, or transport-error. The folder is ignored by Git. The collector defensively redacts common token/secret-shaped fields, but every generated artifact still needs human redaction review before judge sharing or Evidence Vault import. Add `--include-write-checks` only from a private operator shell after the production admin token and private evidence handling are configured.

Run `npm run import:hosted-proof -- --bundle-dir artifacts/hosted-proof/RELEASE_ID --url https://YOUR-CLOUD-RUN-URL --dry-run` to write `evidence-vault-import-request.json` and confirm the redacted request shape without making a network write. After human redaction review, run `SENTINEL_ADMIN_ACTION_TOKEN=... npm run import:hosted-proof -- --bundle-dir artifacts/hosted-proof/RELEASE_ID --url https://YOUR-CLOUD-RUN-URL --confirm-import` from a private operator shell to POST the redacted `verify-production.json` into `/api/evidence/vault/import`; the script stores a redacted import response and summary back into the ignored bundle. It reads the admin token only from `--admin-token-env`, rejects raw token flags, requires hosted HTTPS by default, and allows `--allow-local` only for local smoke tests.

`GET /api/market/positioning` returns the competitor-aware market battlecard. It compares Sentinel against Vanta, Drata, and Secureframe using public positioning, then turns the comparison into a narrow USP, wedge score, differentiators, parity gaps, buyer narrative, market risks, source URLs, and proof actions. It is a positioning aid, not market validation or revenue proof.

## OAuth Scope Discipline

Use the narrowest scopes that support the selected pilot flow. Avoid a public Workspace Marketplace dependency for the first pilot because sensitive/restricted scopes can require OAuth verification and potentially security assessment. Start with a small allowlisted pilot group, consented data access, and explicit customer approval.

`GET /api/oauth/google/start` returns the pilot OAuth launch plan, missing env values, and signed-consent gate. `GET /api/oauth/google/start?dryRun=false` redirects to Google only when the OAuth client id, client secret, redirect URI, and redacted verified `pilot-consent` artifact are all present. The live redirect records a one-time, short-lived OAuth `state` tied to the signed consent artifact. In `gcp-rest` mode that state is written to tenant-scoped Firestore before redirect so Cloud Run restarts or multi-instance callback routing do not bypass the gate. The pilot consent URL requests Drive metadata and Gmail metadata only; the restricted Drive mutation scope is deferred until a tenant explicitly enables human-approved remediation.

`GET /api/oauth/google/callback` handles the Google authorization-code return path. It validates the one-time launch `state` before token exchange, using Firestore with an update-time precondition in `gcp-rest` mode and the local registry in memory mode. In production mode it exchanges the code at Google’s token endpoint, stores only the refresh-token payload as a new Secret Manager version, records a redacted Workspace OAuth install, and leaves Drive/Gmail sync marked `not_configured` until cursors are initialized. Local mode blocks before token exchange if OAuth state, OAuth credentials, or GCP storage are not configured.

`POST /api/workspace/sync/bootstrap` is the production cursor-initialization path after a consented OAuth install. It blocks before live API calls unless `SENTINEL_MOCK_MODE=false`, `SENTINEL_STORAGE_MODE=gcp-rest`, `NEXT_PUBLIC_PRODUCT_URL`, `WORKSPACE_GMAIL_TOPIC`, `WORKSPACE_DRIVE_CHANNEL_TOKEN`, OAuth client credentials, a live Workspace connection, and the Secret Manager refresh-token payload are all present. When configured, it reads the refresh-token payload from Secret Manager, exchanges it for a short-lived Google access token, calls Drive `changes.getStartPageToken`, creates a Drive changes watch for the hosted webhook, starts a Gmail watch, stores Drive/Gmail cursor state to Firestore, and returns only redacted status metadata.

## Workspace Sync Reliability

Drive and Gmail push events are treated as hints, not complete evidence. The control plane follows the official cursor model:

- Drive setup uses `changes.getStartPageToken`, then `changes.watch`, and reconciliation replays `changes.list` from the stored page token.
- Drive channels expire, so renewal state is tracked separately from the latest page token.
- Gmail setup uses `users.watch`, stores the returned `historyId` and expiration, and reconciliation uses `users.history.list`.
- If Gmail returns a stale history cursor in production, the app must perform a full sync before claiming complete coverage.
- Non-demo Gmail Pub/Sub pushes require an authenticated OIDC bearer token with the configured audience, service-account email, and subscription name.
- Direct Drive push notifications require a matching `X-Goog-Channel-Token`; unauthenticated non-demo payloads are rejected instead of falling back to seeded demo events.
- Authenticated production pushes update `lastNotificationAt` and audit evidence only after replay checks. Pub/Sub pushes are deduplicated by `messageId`, Drive channel pushes by channel/resource/message-number, and `gcp-rest` deployments reserve those keys in tenant-scoped Firestore with create-only writes so repeated notifications across Cloud Run instances do not inflate audit evidence. Pushes never create findings from message payloads; scanning must come from Drive/Gmail cursor reconciliation so spoofed or malformed push content cannot become judge evidence.

`GET /api/workspace/sync/status` returns the current cursor/channel state, reliability summary, and renewal plan. `POST /api/workspace/sync/reconcile` advances mock cursors locally, or blocks honestly in live mode until OAuth connection, Drive cursor, and Gmail history cursor are present. `POST /api/workspace/sync/renew` is the production-only watch renewal path after OAuth bootstrap: it exchanges the tenant refresh token through Secret Manager, renews the Drive changes channel and Gmail mailbox watch, persists the new channel/history/expiration metadata, and returns only redacted status evidence. XPRIZE, Devpost, and launch-readiness gates only count Workspace sync proof when Drive has a start/page token and Gmail has a historyId with non-expired live provider status.

## Claim Guard

`GET /api/compliance/claims` scans the app and submission copy for unsafe claims. It blocks phrases such as certification, guaranteed compliance, legal advice, audit assurance, and absolute win certainty unless they appear in explicit negation, questionnaire prompts, or guardrail configuration. Run this before publishing the hosted app, generating the judge packet, or editing the demo script.

## Trust Packets

`POST /api/trust-center/packets` creates a redacted, time-limited prospect packet from the Trust Center Lite profile. The packet includes only approved claims, aggregate risk metrics, AI-operation summaries, consented testimonials, and a questionnaire preview. It excludes customer security findings, private invoices, secrets, and non-consented testimonials. `GET /api/trust-center/packets/[token]` returns an active packet, logs access, and returns `410` after expiry.

`GET /api/trust-center/analytics` summarizes packet creation, active/expired packet counts, total packet access, average access per packet, top prospects, follow-up queue, and production gaps. Local analytics are sales and judge-context signals only; production traction proof still requires hosted packet links, real prospects, and durable Firestore/BigQuery access logs.

`GET /api/trust-center/access-requests` returns Trust Center document visibility and access-request state. `POST /api/trust-center/access-requests` creates a request for selected public/requestable documents. NDA-gated documents require `ndaAccepted=true` before `POST /api/trust-center/access-requests/[id]/approve` will approve them. Private documents cannot be requested or added to prospect packets. Packets include public document summaries plus approved requestable document summaries only.

## Questionnaire Response Packs

`POST /api/questionnaire/packs` accepts pasted text, CSV, TSV, copied spreadsheet text, or PDF-extracted text and creates a customer-specific response pack. Questions are parsed, mapped to evidence categories, tagged by customer segment, drafted from approved product evidence, and left in `draft` or `needs_review` state until a human approves them. `POST /api/questionnaire/packs/[id]/answers/[answerId]/approve` records approval, and `POST /api/questionnaire/packs/[id]/export` produces a markdown response pack with import metadata, citations, and owner roles.

Approved answers are added to the Answer Library with an owner, source pack, segment tags, usage count, verification timestamp, and 90-day review cadence. Future response packs reuse exact approved answers when the question matches, or cite related approved answers as context when wording is similar. `GET /api/questionnaire/library` returns the current library, segment history, and summary. `POST /api/questionnaire/library/[id]/verify` refreshes one item after human review, and `POST /api/questionnaire/library/bulk-verify` refreshes reviewed items by segment or owner role.

## Framework Evidence Packs

`GET /api/frameworks/evidence?framework=SOC2&audience=judge&redacted=true` exports a framework-specific readiness pack for SOC2, ISO 27001, GDPR, HIPAA, or PCI. Audience templates include `judge`, `prospect`, and `auditor`: judge packets emphasize rule evidence and blockers, prospect packets hide internal owner routing and raw findings, and auditor packets preserve owner roles, mapped evidence, and production requirements for readiness planning. HIPAA remains blocked until healthcare scope, BAA terms, and PHI-specific controls exist; this prevents the app from selling healthcare claims before the product is safe for that use case.

## Remediation Playbooks

`GET /api/playbooks` returns tenant-specific remediation playbooks. `POST /api/playbooks` creates or updates a playbook with trigger text, staged actions, owner role, SLA, escalation target, and active/paused state. Automatic execution is blocked unless every action is `no_action` or already appears in the tenant's explicit safe-auto allowlist; mutating actions stay human-approved by default.

## Risk Score History

`GET /api/risk/score-history` returns score snapshots and a trend summary for workspace risk, deal impact, evidence maturity, MRR, active findings, remediations, and AI-operation counts. `POST /api/risk/score-history` captures a manual snapshot. The app also captures snapshots after scans, approvals, remediations, pilot updates, trust packets, questionnaire packs, sync reconciliation, and playbook changes. Local score history is demo proof only; production submission evidence still needs durable Firestore/BigQuery score history from live tenants.

`GET /api/deal-impact/report?redacted=true` returns a redacted deal-impact report for buyer and judge context. It combines score movement, ROI, Trust Packet engagement, questionnaire packs, remediation records, buyer proof points, recommended next actions, and production gaps. The report is sales-readiness evidence only; it does not claim guaranteed revenue, compliance, or security outcomes.

## XPRIZE Submission Gate

`GET /api/xprize/submission-gate` returns the current rule-evidence gate used by the dashboard. It is intentionally strict: local memory mode, mock Gemini runs, mock pilot revenue, missing product URL, missing repository URL, and missing demo video remain blocked or warning states. This prevents the app from treating a polished local demo as proven production evidence.

`GET /api/xprize/provenance` returns the current project-provenance report from the local Git worktree when Git is available. On hosted Cloud Run, where `.git` may not be present in the container image, it falls back to non-secret `SENTINEL_SOURCE_COMMIT`, `SENTINEL_SOURCE_COMMIT_AT`, and `SENTINEL_SOURCE_BRANCH` deployment metadata so release evidence can still identify the deployed source revision. It checks whether commits exist, whether the first commit is after the hackathon start reference, whether source files are tracked, whether a repository URL is configured or detectable from `origin`, whether the local HEAD is present on the upstream branch or declared deployment source metadata, and whether the human attestation flag is still missing. `npm run verify:provenance` emits a terminal JSON report for the same evidence class. A branch with no commits, untracked source files, or an unpushed HEAD remains blocked until the source is committed, pushed/shared, and human-reviewed; deployment source metadata is a hosted runtime fallback, not a replacement for the local source-release/provenance transcript. The current public source repository is `https://github.com/sanjabh11/sme-compliance-sentinel`.

`GET /api/xprize/eligibility-disclosure` returns the private eligibility and disclosure review packet. It combines repository provenance, pre-existing-work disclosure text, third-party/API review status, entrant-attestation flags, judge-access handling, Google/Gemini proof boundaries, and public/private evidence rules into one reviewer artifact. The packet can be `ready-for-review`, but it does not mark human attestations complete; owners still need to set the relevant `XPRIZE_*` flags only after private review.

`GET /api/xprize/source-release` returns the source-release guard for the repository-publishing workflow. It checks required app/library/test/docs/config surfaces, `.gitignore` coverage for private and generated files, a per-file stage/review/ignore plan, and obvious secret patterns before source is committed or pushed. `npm run verify:source-release` provides a terminal guard for the same release hygiene class.

## Submission Compliance Gate

`GET /api/xprize/submission-compliance` returns the rule-clearance gate for Devpost logistics that can disqualify an otherwise strong product: new-project/pre-existing-work disclosure, source repository access, judge product access, demo-video length/visibility/asset clearance, third-party SDK/API authorization, open-source/license review, customer consent, public redaction, and two-business-day evidence-response readiness. It keeps these items separate from product quality so the team can fix submission risks before upload.

`GET /api/xprize/judge-access-pack` returns the non-secret judge access packet. It verifies whether the product URL, repository URL, public demo video, private judge testing instructions, and free judging-period access are ready; lists signed-out smoke commands and a safe walkthrough; defines credential-handling rules; and routes support/evidence-response ownership. It never includes judge credentials, admin tokens, OAuth secrets, customer findings, invoices, or private evidence in the response.

`GET /api/xprize/license-manifest` returns the dependency and third-party API manifest generated from `package.json` and `package-lock.json`. It summarizes direct runtime dependencies, development dependencies, transitive packages, license review status, Google API integrations, disclosure text, blockers, and next actions. The scanner separates restricted blockers from license-review and obligation-review packages; for example, optional transitive packages with LGPL-style obligations are routed to human obligation review instead of being treated as automatic replacement blockers. The manifest is submission-support evidence only; set `XPRIZE_THIRD_PARTY_REVIEW_APPROVED=true` only after a human owner reviews dependency licenses, notice/distribution obligations, Google API terms, and final asset/IP use. A human approval flag does not mark license/IP proof ready while the generated manifest still has blocked restricted-license or unknown-license items.

## Evidence Packet Formats

`GET /api/evidence/export?redacted=true` returns the JSON evidence packet used by the dashboard. Add `format=markdown` or `format=csv` to produce judge/customer-readable packets with revenue by month, costs, CAC, consent summary, related-party separation, operation counters, pilot records, agent-run summaries, and audit-chain integrity status. Redacted packets remove customer names and private segments while preserving proof status and consent boundaries.

`GET /api/evidence/signed-packet?redacted=true` returns a print-ready HTML packet with a SHA-256 digest over the canonical evidence export. Each new audit event is also linked into a newest-first SHA-256 hash chain, and the export reports the audit-chain head hash, sealed count, legacy-backfill count, and verification status. If a deployment already has unsealed local audit rows, the app backfills hash metadata, labels those rows with `integrityBackfilledAt`, and records an `audit_integrity_backfilled` event rather than pretending they were historically sealed. If `SENTINEL_EVIDENCE_SIGNING_SECRET` is configured, the packet adds an HMAC-SHA256 signature; otherwise it is explicitly marked `unsigned-local` and lists production signing gaps. This is tamper-evidence for packet review, not certification or audit assurance.

## Financial Evidence Ledger

`GET /api/financial-evidence/ledger` returns the private business-proof ledger behind the Pilot CRM. It labels each revenue month, pilot invoice, cost record, CAC record, active-user proof, testimonial consent, and related-party review as `mock-only`, `missing`, `private-on-request`, or `verified`. Local seeded records stay blocked as submission proof until `SENTINEL_EVIDENCE_MODE=production`, durable storage is configured, and invoices/payment records, active-user logs, cost/CAC receipts, and consent records are available for private judge review.

## Private Evidence Vault

`GET /api/evidence/vault` returns the private artifact register for submission and sales proof. It creates required artifact slots for pilot invoices, testimonial consent, active-user logs, operating costs, CAC receipts, Google Cloud billing proof, Gemini usage logs, Workspace OAuth/sync logs, hosted product URL, repository URL, demo video, and reviewed trust policies. Product and demo URLs are not treated as complete proof until judge access, free judging-period access, demo duration, public visibility, English/subtitle, asset clearance, and customer-data redaction confirmations are present. Each artifact has an owner, status, redaction flag, private-handling rule, optional SHA-256 checksum, blocker, and next action.

`POST /api/evidence/vault` registers or updates a private artifact by id. The local vault improves workflow discipline, but it does not turn local files or seeded records into production proof until `SENTINEL_EVIDENCE_MODE=production`, `SENTINEL_STORAGE_MODE=gcp-rest`, and real private documents/logs are available for judge request.

`POST /api/evidence/vault/import` accepts a redacted JSON object from `npm run verify:production`, `/api/production/hosted-evidence`, `/api/production/deployment-evidence`, `/api/production/gemini-smoke`, `/api/production/persistence`, `/api/workspace/sync/bootstrap`, or `/api/production/cost-controls`. The importer computes a SHA-256 checksum, maps supported rows to expected Evidence Vault artifact slots, marks local or unredacted imports as non-final proof, and stores only redacted source summaries in the dashboard response. In production mode it requires the Secret Manager-backed `SENTINEL_ADMIN_ACTION_TOKEN` through `x-sentinel-admin-token` or a Bearer token. Use `npm run import:hosted-proof` for the hosted `verify-production.json` path so raw admin tokens stay in environment variables and generated request/response files remain under the ignored proof bundle. The same production-token guard protects Gemini smoke, persistence write-through, cost-control write-through, Workspace reconciliation, and Workspace bootstrap POST endpoints. Keep full source JSON in the private evidence store, not in the repository.

`GET /api/evidence/vault?view=intake` returns the Evidence Intake Queue. It sorts required artifacts by pilot-conversion priority, proof status, and redaction risk; lists accepted proof examples and rejection triggers; and provides safe registration payload templates for `POST /api/evidence/vault`. It stays blocked in mock mode and does not treat registered local artifacts as production proof.

## One-Day Pilot Launch Plan

`GET /api/pilots/launch-plan` returns the sales and execution plan for a paid pilot. It includes the $199 offer, target segment, launch-readiness score, day-one checklist, one-day timeline, buyer objections, blockers, and next actions. The plan is intentionally strict: mock scan proof, missing OAuth, missing production persistence, incomplete judge access, demo-video clearance gaps, and absent private artifacts remain visible until real pilot evidence exists.

## Paid Pilot Prospect Pipeline

`GET /api/pilots/prospects` returns the prospect-to-paid-pilot pipeline: high-fit target count, active opportunities, proposed pilots, estimated pipeline MRR, weighted pipeline MRR, outreach sequence, blockers, and claim boundaries. `POST /api/pilots/prospects` creates or updates a prospect record with segment, stage, source, fit score, estimated MRR, objection, next action, and evidence needed. Prospect entries are sales-operations planning evidence only; they are not revenue proof until an arms-length paid pilot and private artifacts exist.

`GET /api/pilots/conversion-kit` returns the paid-pilot close kit for the next high-fit prospect. It includes the selected prospect, conversion score, founder email, scope-call script, fixed-scope proposal, consent boundary, invoice checklist, required evidence checklist, blockers, and next actions. It is intentionally blocked while invoice/payment proof, consent, OAuth install proof, active-user proof, Gemini/GCP logs, and customer reference artifacts are missing or mock-only.

`GET /api/pilots/consent-packet` returns the Pilot Consent & Scope Packet for the next high-fit prospect. It lists allowed Workspace sources, excluded/deferred data, requested and deferred OAuth scopes, AI data-minimization rules, HITL remediation rules, required private artifacts, signature fields, blockers, and a markdown-ready export. It is a pre-OAuth handoff artifact and remains blocked as evidence until signed consent is registered as a redacted `pilot-consent` artifact.

## XPRIZE Submission Binder

`GET /api/xprize/submission-binder` returns the private judge-readiness binder. It wraps the Submission Gate with an artifact manifest, owner roles, redaction handling, testing-instruction status, demo timeline, private evidence request queue, claim boundaries, and final pre-submit checks. Missing or mock-only evidence stays labeled as missing or mock-only so the product does not overstate readiness before Cloud Run, Gemini API, Workspace OAuth, and real customer proof exist.

## Devpost Submission Pack

`GET /api/xprize/devpost-pack` returns the claim-safe submission pack for the final upload workflow. It includes public description sections, problem/solution/business model copy, Google stack wording, a public demo script capped below three minutes, screenshot checklist, testing-instruction draft, private evidence response plan, a public-safe evidence readiness export, blockers, next actions, and claim boundaries. The readiness export maps product access, repository access, demo video, revenue/cost/CAC, real-user proof, AI-operation proof, category impact, and IP/safety buckets to current status without exposing customer aliases, invoices, security findings, contact details, credentials, or unconsented testimonials. It is intentionally blocked while product URL, repository URL, public demo video, production Google Cloud/Gemini proof, and real customer evidence are missing.

## Demo Video Compliance Pack

`GET /api/xprize/demo-video-pack` returns the rule-specific video readiness pack. It parses the Devpost script into timed scenes, enforces a 180-second maximum, checks the public YouTube/Vimeo/Youku URL, blocks readiness until English/subtitle, duration, visibility, asset, redaction, and live-Gemini proof gates are cleared, and gives a recording checklist for the final public upload.

## XPRIZE Rule Notes

- Antigravity is not a mandatory app dependency.
- A Google Cloud product is required.
- If the app includes LLM functionality, at least one deployed LLM call must use Gemini API.
- Submissions need a code repository, working product URL, demo video under 3 minutes, revenue evidence, cost evidence, real user evidence, and testimonials only with user awareness/consent.
