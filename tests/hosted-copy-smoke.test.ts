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

describe("hosted copy smoke verifier", () => {
  it("passes customer routes and allows admin claim-guard questionnaire context", async () => {
    const baseUrl = await startFixtureServer({
      "/": customerPage(),
      "/demo/customer": customerPage(),
      "/admin": [
        "<main>",
        "<h1>Admin Console</h1>",
        "<section>Questionnaire Assistant</section>",
        "<p>Question: Are you SOC2 certified? No certification claim is made by Sentinel.</p>",
        "<section>Claim guard banned claims watched.</section>",
        "</main>"
      ].join("")
    });
    const outPath = join(mkdtempSync(join(tmpdir(), "sentinel-hosted-copy-")), "report.json");
    const result = await runVerifier(["--url", baseUrl, "--out", outPath, "--strict"]);

    expect(result.status).toBe(0);
    const report = JSON.parse(readFileSync(outPath, "utf8"));

    expect(report.overallStatus).toBe("verified");
    expect(report.routes).toHaveLength(3);
    expect(report.routes.find((route: { id: string }) => route.id === "admin-console")?.status).toBe("ready");
    expect(report.proofBoundary).toContain("not revenue proof");
  });

  it("blocks internal proof language on customer routes", async () => {
    const baseUrl = await startFixtureServer({
      "/": `${customerPage()}<p>XPRIZE judge export ready.</p>`,
      "/demo/customer": customerPage(),
      "/admin": "<main><p>Claim guard banned claims watched.</p></main>"
    });
    const result = await runVerifier(["--url", baseUrl, "--strict"]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('"overallStatus": "blocked"');
    expect(result.stdout).toContain("Forbidden public phrase: XPRIZE");
    expect(result.stdout).toContain("Forbidden public phrase: judge export");
  });

  it("blocks admin compliance claims outside allowed educational context", async () => {
    const baseUrl = await startFixtureServer({
      "/": customerPage(),
      "/demo/customer": customerPage(),
      "/admin": "<main><h1>We are SOC2 certified for every customer.</h1></main>"
    });
    const result = await runVerifier(["--url", baseUrl, "--strict"]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('"overallStatus": "blocked"');
    expect(result.stdout).toContain("Admin contextual phrase: SOC2 certified");
    expect(result.stdout).toContain("outside allowed context");
  });
});

function customerPage() {
  return [
    "<main>",
    "<h1>One-day Google Workspace risk scan</h1>",
    "<p>SOC2 readiness evidence for seed-stage teams.</p>",
    "<p>Sample data only.</p>",
    "<button>Get my sample risk scan</button>",
    "<a>Book my one-day scan</a>",
    "</main>"
  ].join("");
}

function runVerifier(args: string[]) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/verify-hosted-copy-smoke.mjs", ...args], {
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
