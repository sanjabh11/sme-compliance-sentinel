import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

type RouteMap = Record<string, string>;

const servers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("hosted business verification verifier", () => {
  it("passes when support and Stripe policy pages expose complete business details", async () => {
    const baseUrl = await startFixtureServer({
      "/support": supportPage({ includeChecklist: true, completeDetails: true }),
      "/terms-of-service": termsPage(),
      "/privacy": privacyPage(),
      "/cancellation-refund-policy": refundPage()
    });
    const outPath = join(mkdtempSync(join(tmpdir(), "sentinel-hosted-business-")), "report.json");
    const result = await runVerifier(["--url", baseUrl, "--out", outPath, "--strict"]);
    const report = JSON.parse(readFileSync(outPath, "utf8"));

    expect(result.status).toBe(0);
    expect(report.overallStatus).toBe("ready-for-stripe-submit");
    expect(report.stripeDashboardValues.customerSupportUrl).toBe(`${baseUrl}/support`);
    expect(report.requiredPublicEnv).toContain("NEXT_PUBLIC_BUSINESS_REGISTERED_ADDRESS");
    expect(report.proofBoundary).toContain("does not prove Stripe account acceptance");
  });

  it("blocks stale support deployments that do not include the verification checklist", async () => {
    const baseUrl = await startFixtureServer({
      "/support": supportPage({ includeChecklist: false, completeDetails: false }),
      "/terms-of-service": termsPage(),
      "/privacy": privacyPage(),
      "/cancellation-refund-policy": refundPage()
    });
    const result = await runVerifier(["--url", baseUrl, "--strict"]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('"overallStatus": "blocked"');
    expect(result.stdout).toContain("support-business-verification-card");
    expect(result.stdout).toContain("Deploy the latest repo build");
  });

  it("keeps missing public owner business details as owner action instead of code failure", async () => {
    const baseUrl = await startFixtureServer({
      "/support": supportPage({ includeChecklist: true, completeDetails: false }),
      "/terms-of-service": termsPage(),
      "/privacy": privacyPage(),
      "/cancellation-refund-policy": refundPage()
    });
    const result = await runVerifier(["--url", baseUrl]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"overallStatus": "owner-action-required"');
    expect(result.stdout).toContain("NEXT_PUBLIC_BUSINESS_SUPPORT_PHONE");
    expect(result.stdout).toContain("placeholder text visible");
  });
});

function supportPage({ includeChecklist, completeDetails }: { includeChecklist: boolean; completeDetails: boolean }) {
  const checklist = includeChecklist
    ? [
        '<article class="business-verification-card">',
        "<h2>Stripe business verification status</h2>",
        "<span>Ready for Stripe</span>",
        "</article>"
      ].join("")
    : "";
  const address = completeDetails
    ? "Registered office, Bengaluru, Karnataka, India"
    : "Owner must add the registered India business address before using this page for Stripe verification.";
  const phone = completeDetails
    ? "+91 80000 00000"
    : "Owner must add a domestic India support telephone number before using this page for Stripe verification.";
  const email = completeDetails
    ? "support@example.com"
    : "Owner must add a monitored support email before using this page for Stripe verification.";

  return [
    "<main>",
    checklist,
    "<dl>",
    `<dt>Registered company address</dt><dd>${address}</dd>`,
    `<dt>Domestic telephone number in India</dt><dd>${phone}</dd>`,
    `<dt>Support email</dt><dd>${email}</dd>`,
    "</dl>",
    "</main>"
  ].join("");
}

function termsPage() {
  return "<main><h1>Terms of service</h1><h2>Cancellation and refunds</h2></main>";
}

function privacyPage() {
  return [
    "<main>",
    "<h1>Privacy Policy</h1>",
    "<h2>Information we collect</h2>",
    "<h2>How we use information</h2>",
    "<h2>Disclosure and retention</h2>",
    "</main>"
  ].join("");
}

function refundPage() {
  return "<main><h1>Cancellation and Refund Policy</h1><p>Refund request process is handled manually.</p></main>";
}

function runVerifier(args: string[]) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/verify-hosted-business-verification.mjs", ...args], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: string[] = [];
    const stderr: string[] = [];

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({ status, stdout: stdout.join(""), stderr: stderr.join("") });
    });
  });
}

async function startFixtureServer(routes: RouteMap) {
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const body = routes[url.pathname] ?? "";

    response.writeHead(body ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
    response.end(body || "missing");
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  servers.push({
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      })
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fixture server did not expose a TCP address.");
  }

  return `http://127.0.0.1:${address.port}`;
}
