import { createHash } from "node:crypto";
import { redactEvidenceText } from "@/lib/evidence-copilot";
import type {
  EvidenceDocumentAnalysisRequest,
  EvidenceDocumentAnalysisResult,
  EvidenceDocumentCitation,
  EvidenceDocumentInputKind,
  EvidenceVaultArtifactKind,
  EvidenceVaultArtifactStatus
} from "@/lib/types";

const datePattern =
  /\b(?:20\d{2}[-/](?:0?[1-9]|1[0-2])[-/](?:0?[1-9]|[12]\d|3[01])|(?:0?[1-9]|[12]\d|3[01])[-/](?:0?[1-9]|1[0-2])[-/]20\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+20\d{2})\b/giu;

export function analyzeEvidenceDocument(input: EvidenceDocumentAnalysisRequest): EvidenceDocumentAnalysisResult {
  const documentName = cleanText(input.documentName || "Untitled evidence document", 160);
  const inputKind = normalizeInputKind(input.inputKind);
  const normalized = normalizeDocumentText(input.text ?? "", inputKind);
  const redactedPreview = redactEvidenceText(normalized).slice(0, 900);
  const documentKind = detectDocumentKind(inputKind, documentName, normalized);
  const detectedDates = [...new Set(normalized.match(datePattern) ?? [])].slice(0, 8);
  const sensitiveMarkers = detectSensitiveMarkers(normalized, input.metadata);
  const checksumValid = Boolean(input.checksumSha256 && /^[a-f0-9]{64}$/iu.test(input.checksumSha256));
  const checksumRequired = documentKind !== "image-only";
  const citations = buildDocumentCitations(normalized, inputKind);
  const suggestion = suggestEvidenceVaultRoute(documentKind, sensitiveMarkers, checksumValid);
  const blockers = [
    ...(checksumRequired && !checksumValid ? ["A valid SHA-256 checksum is required before Evidence Vault registration."] : []),
    ...(sensitiveMarkers.length > 0 ? ["Sensitive markers require redaction review before judge or customer export."] : []),
    ...(documentKind === "image-only" ? ["Image-only evidence needs OCR or Document AI/Gemini document understanding before text claims."] : [])
  ];

  return {
    generatedAt: new Date().toISOString(),
    documentName,
    inputKind,
    documentKind,
    normalizedTextPreview: redactedPreview,
    detectedDates,
    customerAlias: detectCustomerAlias(normalized),
    sensitiveMarkers,
    redactionChecklist: buildRedactionChecklist(documentKind, sensitiveMarkers),
    checksumRequired,
    checksumValid,
    evidenceVaultSuggestion: suggestion,
    citations,
    blockers,
    privateHandling: [
      "Do not persist raw uploaded content in BigQuery or judge exports.",
      "Store only redacted excerpts, checksums, artifact status, and owner routing in public-safe packets.",
      "Use Document AI Layout Parser or Gemini document understanding only after production consent and storage boundaries are configured."
    ],
    disclaimer:
      "This scanner classifies local text fixtures and metadata for evidence routing. It is not live Document AI proof and does not validate the underlying document."
  };
}

export function normalizeDocumentText(text: string, inputKind: EvidenceDocumentInputKind) {
  const normalized = String(text ?? "")
    .replace(/\r\n?/gu, "\n")
    .split("\u0000")
    .join("")
    .replace(/[ \t]+/gu, " ")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();

  if (inputKind === "csv" || inputKind === "tsv" || inputKind === "spreadsheet-text") {
    return normalized
      .split("\n")
      .map((line) => line.split(inputKind === "tsv" ? "\t" : /,(?=(?:[^"]*"[^"]*")*[^"]*$)/u).map((cell) => cell.replace(/^"|"$/gu, "").trim()).join(" | "))
      .join("\n");
  }

  if (inputKind === "image-metadata" && !normalized) {
    return "Image-only evidence placeholder. OCR or layout parsing is required before extracting textual claims.";
  }

  return normalized;
}

export function checksumDocumentText(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function normalizeInputKind(value: EvidenceDocumentInputKind): EvidenceDocumentInputKind {
  return [
    "pdf-text",
    "csv",
    "tsv",
    "spreadsheet-text",
    "image-metadata",
    "security-questionnaire",
    "contract",
    "invoice",
    "soc2-readiness",
    "gcp-proof",
    "plain-text"
  ].includes(value)
    ? value
    : "plain-text";
}

function detectDocumentKind(inputKind: EvidenceDocumentInputKind, name: string, text: string): EvidenceDocumentAnalysisResult["documentKind"] {
  const haystack = `${name}\n${text}`.toLowerCase();
  if (inputKind === "image-metadata") return "image-only";
  if (inputKind === "csv" || inputKind === "tsv" || inputKind === "spreadsheet-text") return "spreadsheet";
  if (inputKind === "security-questionnaire" || /\b(questionnaire|security review|vendor assessment)\b/u.test(haystack)) return "security-questionnaire";
  if (inputKind === "contract" || /\b(master services agreement|msa|terms|agreement|contract)\b/u.test(haystack)) return "contract";
  if (inputKind === "invoice" || /\b(invoice|payment due|amount due|receipt)\b/u.test(haystack)) return "invoice";
  if (inputKind === "soc2-readiness" || /\b(soc2|soc 2|cc6\.1|trust services|readiness)\b/u.test(haystack)) return "soc2-readiness";
  if (inputKind === "gcp-proof" || /\b(cloud run|bigquery|firestore|secret manager|artifact registry|gemini)\b/u.test(haystack)) return "gcp-proof";
  return "unknown";
}

function detectSensitiveMarkers(text: string, metadata?: Record<string, string | number | boolean | null>) {
  const haystack = `${text}\n${JSON.stringify(metadata ?? {})}`;
  const markers = new Set<string>();

  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu.test(haystack)) markers.add("email-address");
  if (/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/iu.test(haystack)) markers.add("aws-key-like-secret");
  if (/\b(api[_\s-]?key|client[_\s-]?secret|refresh[_\s-]?token|bearer)\b/iu.test(haystack)) markers.add("credential-marker");
  if (/\b\d{3}-\d{2}-\d{4}\b/u.test(haystack)) markers.add("ssn-like-pattern");
  if (/\b(?:\d[ -]*?){13,16}\b/u.test(haystack)) markers.add("payment-card-like-pattern");
  if (/\b(invoice|payment|receipt)\b/iu.test(haystack)) markers.add("financial-document-marker");
  if (/\b(customer|client|prospect)\b/iu.test(haystack)) markers.add("customer-reference");

  return [...markers];
}

function detectCustomerAlias(text: string) {
  const match =
    text.match(/\b(?:customer|client|prospect)\s*(?:alias|name)?\s*[:-]\s*([A-Za-z0-9 ._-]{3,80})/iu) ??
    text.match(/\b(?:bill to|sold to)\s*[:-]\s*([A-Za-z0-9 ._-]{3,80})/iu);

  return match?.[1] ? redactEvidenceText(match[1]).slice(0, 80) : undefined;
}

function buildDocumentCitations(text: string, inputKind: EvidenceDocumentInputKind): EvidenceDocumentCitation[] {
  const chunks = text
    ? text
        .split(/\n{2,}|(?=^#{1,3}\s)/gmu)
        .map((chunk) => chunk.trim())
        .filter(Boolean)
    : ["Image-only evidence placeholder. OCR or layout parsing is required before extracting textual claims."];

  return chunks.slice(0, 5).map((chunk, index) => ({
    label: `${inputKind} section ${index + 1}`,
    page: inputKind === "pdf-text" ? index + 1 : undefined,
    section: `section-${index + 1}`,
    excerpt: redactEvidenceText(chunk).slice(0, 360)
  }));
}

function suggestEvidenceVaultRoute(
  documentKind: EvidenceDocumentAnalysisResult["documentKind"],
  sensitiveMarkers: string[],
  checksumValid: boolean
) {
  const kindMap: Record<EvidenceDocumentAnalysisResult["documentKind"], EvidenceVaultArtifactKind> = {
    "security-questionnaire": "trust-policy",
    contract: "customer-reference",
    invoice: "pilot-invoice",
    "soc2-readiness": "trust-policy",
    "gcp-proof": "cloud-run-proof",
    spreadsheet: "payment-export",
    "image-only": "production-readiness-report",
    unknown: "production-readiness-report"
  };
  const kind = kindMap[documentKind];
  const needsRedaction = sensitiveMarkers.length > 0;
  const status: EvidenceVaultArtifactStatus = !checksumValid ? "requested" : needsRedaction ? "needs-redaction" : "uploaded";

  return {
    kind,
    status,
    ownerRole: documentKind === "invoice" || documentKind === "spreadsheet" ? "finance" : documentKind === "contract" ? "legal" : "engineering",
    nextAction:
      status === "needs-redaction"
        ? "Redact sensitive markers and attach a SHA-256 checksum before judge-facing use."
        : status === "requested"
          ? "Add a SHA-256 checksum and route the artifact to the private Evidence Vault."
          : "Register the redacted artifact and checksum in the private Evidence Vault."
  } as const;
}

function buildRedactionChecklist(documentKind: EvidenceDocumentAnalysisResult["documentKind"], markers: string[]) {
  const checklist = [
    "Remove raw secrets, OAuth tokens, API keys, bearer tokens, and passwords.",
    "Redact customer-identifying fields unless explicit consent exists.",
    "Keep private invoice/payment references out of judge exports.",
    "Store only checksum, source description, owner routing, and redacted excerpts."
  ];

  if (documentKind === "image-only") {
    checklist.push("Run OCR/layout parsing before citing visual evidence.");
  }

  for (const marker of markers) {
    checklist.push(`Review and redact ${marker}.`);
  }

  return [...new Set(checklist)];
}

function cleanText(value: string, maxLength: number) {
  const cleaned = String(value ?? "").replace(/\s+/gu, " ").trim();
  return cleaned.length <= maxLength ? cleaned : `${cleaned.slice(0, maxLength - 1)}…`;
}
