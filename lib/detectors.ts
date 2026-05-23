import type { DetectorFinding, ResourceEvent } from "@/lib/types";

export interface SensitiveDataProtectionDetectorResult {
  findings: DetectorFinding[];
  attempted: boolean;
  status: "disabled" | "missing_config" | "passed" | "failed";
}

const secretPatterns: Array<{ type: string; pattern: RegExp; likelihood: DetectorFinding["likelihood"] }> = [
  {
    type: "AWS_SECRET_ACCESS_KEY",
    pattern: /(?:aws[_-]?secret[_-]?access[_-]?key|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*([A-Za-z0-9/+]{32,})/gi,
    likelihood: "very_likely"
  },
  {
    type: "PRIVATE_KEY",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi,
    likelihood: "very_likely"
  },
  {
    type: "GENERIC_API_KEY",
    pattern: /(?:api[_-]?key|secret|token)\s*[:=]\s*["']?([A-Za-z0-9_-]{24,})["']?/gi,
    likelihood: "likely"
  }
];

const piiPatterns: Array<{ type: string; pattern: RegExp; likelihood: DetectorFinding["likelihood"] }> = [
  {
    type: "US_SOCIAL_SECURITY_NUMBER",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    likelihood: "likely"
  },
  {
    type: "CREDIT_CARD_NUMBER",
    pattern: /\b(?:\d[ -]*?){13,16}\b/g,
    likelihood: "possible"
  },
  {
    type: "EMAIL_ADDRESS",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    likelihood: "possible"
  }
];

export function runLocalRegexDetectors(content: string): DetectorFinding[] {
  const findings: DetectorFinding[] = [];

  for (const { type, pattern, likelihood } of [...secretPatterns, ...piiPatterns]) {
    for (const match of content.matchAll(pattern)) {
      findings.push({
        tier: "tier1_deterministic",
        type,
        quote: sanitizeQuote(match[0]),
        likelihood,
        offset: match.index
      });
    }
  }

  return findings;
}

export async function runSensitiveDataProtectionDetector(event: ResourceEvent): Promise<SensitiveDataProtectionDetectorResult> {
  const content = event.content ?? "";
  if (!content.trim()) {
    return { findings: [], attempted: false, status: "disabled" };
  }

  const cloudProject = process.env.GOOGLE_CLOUD_PROJECT;
  if (process.env.SENSITIVE_DATA_PROTECTION_ENABLED !== "true") {
    return { findings: [], attempted: false, status: "disabled" };
  }

  const token = process.env.GOOGLE_CLOUD_ACCESS_TOKEN ?? (await getMetadataServerAccessToken());
  if (!cloudProject || !token) {
    return { findings: [], attempted: false, status: "missing_config" };
  }

  const response = await fetch(
    `https://dlp.googleapis.com/v2/projects/${cloudProject}/locations/global/content:inspect`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        inspectConfig: {
          includeQuote: true,
          minLikelihood: "POSSIBLE",
          infoTypes: [
            { name: "EMAIL_ADDRESS" },
            { name: "US_SOCIAL_SECURITY_NUMBER" },
            { name: "CREDIT_CARD_NUMBER" },
            { name: "PERSON_NAME" },
            { name: "AUTH_TOKEN" },
            { name: "AWS_CREDENTIALS" }
          ]
        },
        item: { value: content }
      })
    }
  );

  if (!response.ok) {
    return { findings: [], attempted: true, status: "failed" };
  }

  const payload = (await response.json()) as {
    result?: {
      findings?: Array<{
        infoType?: { name?: string };
        quote?: string;
        likelihood?: string;
        location?: { byteRange?: { start?: string } };
      }>;
    };
  };

  return {
    attempted: true,
    status: "passed",
    findings: (payload.result?.findings ?? []).map((finding) => ({
      tier: "tier1_sdp",
      type: finding.infoType?.name ?? "SENSITIVE_DATA",
      quote: sanitizeQuote(finding.quote ?? ""),
      likelihood: normalizeLikelihood(finding.likelihood),
      offset: finding.location?.byteRange?.start ? Number(finding.location.byteRange.start) : undefined
    }))
  };
}

export function isHighRiskDocument(event: ResourceEvent, findings: DetectorFinding[]) {
  const extensionRisk = /\.(env|pem|key|sql|csv|xlsx|docx|pdf|ts|tsx|js|jsx|py|rb|go|java|cs)$/i.test(
    event.resourceName
  );
  const labelRisk = event.labels.some((label) =>
    ["security-review", "customer-data", "legal", "proposal", "source-code", "finance"].includes(label)
  );
  const publicSensitive = event.sharing.public || event.sharing.anyoneWithLink;
  const hasStrongFinding = findings.some((finding) =>
    ["AWS_SECRET_ACCESS_KEY", "PRIVATE_KEY", "US_SOCIAL_SECURITY_NUMBER", "CREDIT_CARD_NUMBER"].includes(finding.type)
  );

  return publicSensitive || extensionRisk || labelRisk || hasStrongFinding;
}

function sanitizeQuote(quote: string) {
  const redacted = quote
    .replace(/(AWS_SECRET_ACCESS_KEY\s*[:=]\s*)[A-Za-z0-9/+]{16,}/gi, "$1[redacted-secret]")
    .replace(/(api[_-]?key|secret|token)(\s*[:=]\s*)["']?[A-Za-z0-9_-]{16,}["']?/gi, "$1$2[redacted-secret]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[redacted-ssn]")
    .replace(/\b(?:\d[ -]*?){13,16}\b/g, "[redacted-card]");

  if (redacted.length <= 96) {
    return redacted;
  }

  return `${redacted.slice(0, 42)}...${redacted.slice(-18)}`;
}

function normalizeLikelihood(value?: string): DetectorFinding["likelihood"] {
  switch (value?.toLowerCase()) {
    case "very_likely":
      return "very_likely";
    case "likely":
      return "likely";
    case "possible":
      return "possible";
    case "unlikely":
      return "unlikely";
    default:
      return "possible";
  }
}

async function getMetadataServerAccessToken() {
  try {
    const response = await fetch(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      {
        headers: { "Metadata-Flavor": "Google" },
        signal: AbortSignal.timeout(500)
      }
    );

    if (!response.ok) {
      return undefined;
    }

    const payload = (await response.json()) as { access_token?: string };
    return payload.access_token;
  } catch {
    return undefined;
  }
}
