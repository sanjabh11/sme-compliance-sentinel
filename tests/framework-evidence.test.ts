import { describe, expect, it } from "vitest";
import { scanClaimText } from "@/lib/claim-guard";
import {
  buildFrameworkEvidencePack,
  buildFrameworkCoverage,
  parseFrameworkAudience,
  parseFrameworkName
} from "@/lib/framework-evidence";
import { createDemoEvent, getDashboardSnapshot, ingestResourceEvent, resetState } from "@/lib/store";

describe("framework evidence packs", () => {
  it("exports a redacted SOC2 readiness pack with control status and production gaps", async () => {
    resetState();
    await ingestResourceEvent(createDemoEvent("public-secret"));

    const pack = buildFrameworkEvidencePack(getDashboardSnapshot(), { framework: "SOC2", redacted: true });

    expect(pack.framework).toBe("SOC2");
    expect(pack.audience).toBe("judge");
    expect(pack.redacted).toBe(true);
    expect(pack.controls.length).toBeGreaterThanOrEqual(3);
    expect(pack.summary.productionRequired).toBeGreaterThan(0);
    expect(pack.exportText).toContain("SOC2 Readiness Evidence Pack");
    expect(pack.exportText).toContain("Audience: judge");
    expect(pack.exportText).toContain("Boundary: readiness evidence only");
    expect(pack.controls.some((control) => control.id === "soc2_cc6_access_controls")).toBe(true);
    expect(scanClaimText({ artifact: "framework-pack", text: pack.exportText })).toEqual([]);
  });

  it("keeps HIPAA behind explicit scope and BAA gaps", async () => {
    resetState();

    const pack = buildFrameworkEvidencePack(getDashboardSnapshot(), { framework: "HIPAA", redacted: true });
    const scopeControl = pack.controls.find((control) => control.id === "hipaa_scope_boundary");

    expect(pack.coverageLevel).toBe("planned");
    expect(scopeControl?.status).toBe("blocked");
    expect(scopeControl?.gaps.join(" ")).toContain("BAA");
    expect(pack.disclaimer).toContain("readiness evidence only");
  });

  it("lists supported frameworks and falls back safely for unknown input", () => {
    expect(buildFrameworkCoverage().map((item) => item.framework)).toEqual(["SOC2", "ISO 27001", "GDPR", "HIPAA", "PCI"]);
    expect(parseFrameworkName("gdpr")).toBe("GDPR");
    expect(parseFrameworkName("unknown")).toBe("SOC2");
    expect(parseFrameworkAudience("prospect")).toBe("prospect");
    expect(parseFrameworkAudience("auditor")).toBe("auditor");
    expect(parseFrameworkAudience("unknown")).toBe("judge");
  });

  it("builds prospect-safe and auditor-review templates with different boundaries", async () => {
    resetState();
    await ingestResourceEvent(createDemoEvent("public-secret"));

    const prospectPack = buildFrameworkEvidencePack(getDashboardSnapshot(), {
      framework: "GDPR",
      redacted: true,
      audience: "prospect"
    });
    const auditorPack = buildFrameworkEvidencePack(getDashboardSnapshot(), {
      framework: "GDPR",
      redacted: true,
      audience: "auditor"
    });

    expect(prospectPack.audience).toBe("prospect");
    expect(prospectPack.hiddenSections.join(" ")).toContain("private security findings");
    expect(prospectPack.controls.every((control) => control.exportSafe)).toBe(true);
    expect(prospectPack.controls.every((control) => control.ownerRole === "sales")).toBe(true);
    expect(prospectPack.exportText).toContain("Audience: prospect");
    expect(auditorPack.audience).toBe("auditor");
    expect(auditorPack.includedSections.join(" ")).toContain("production requirements");
    expect(auditorPack.controls.some((control) => control.ownerRole !== "sales")).toBe(true);
    expect(scanClaimText({ artifact: "prospect-framework-pack", text: prospectPack.exportText })).toEqual([]);
    expect(scanClaimText({ artifact: "auditor-framework-pack", text: auditorPack.exportText })).toEqual([]);
  });
});
