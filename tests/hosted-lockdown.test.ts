import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

type RouteHandler = (request: IncomingMessage, response: ServerResponse) => void;

const servers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("hosted lockdown verifier", () => {
  it("verifies public routes, signed-out locks, no-store headers, and operator access", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sentinel-hosted-lockdown-"));
    const operatorPath = join(tempDir, "operator.txt");
    const outPath = join(tempDir, "report.json");
    writeFileSync(operatorPath, "private-admin-token", "utf8");

    try {
      const baseUrl = await startFixtureServer((request, response) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        const adminHeader = request.headers["x-sentinel-admin-token"];

        if (url.pathname === "/" || url.pathname === "/demo/customer") {
          html(response, 200, "<main>Get my sample risk scan</main>");
          return;
        }

        if (
          url.pathname === "/api/xprize/judge-access-pack" ||
          url.pathname === "/api/xprize/submission-gate" ||
          url.pathname === "/api/compliance/claims"
        ) {
          json(response, 200, { ok: true });
          return;
        }

        if (url.pathname === "/admin") {
          html(response, 200, '<main class="admin-unlock-shell" aria-label="Admin console locked">Unlock admin console</main>', {
            "cache-control": "private, no-cache, no-store"
          });
          return;
        }

        if (url.pathname === "/api/readiness" && adminHeader === "private-admin-token") {
          json(response, 200, { ok: true, status: "ready" }, { "cache-control": "no-store" });
          return;
        }

        if (url.pathname.startsWith("/api/")) {
          json(response, 401, { ok: false, error: "Missing operator access." }, { "cache-control": "no-store" });
          return;
        }

        html(response, 404, "missing");
      });

      const result = await runVerifier(["--url", baseUrl, "--operator-file", operatorPath, "--out", outPath, "--strict"]);
      const report = JSON.parse(readFileSync(outPath, "utf8"));

      expect(result.status).toBe(0);
      expect(report.overallStatus).toBe("verified");
      expect(report.sections.find((section: { id: string }) => section.id === "admin-signed-out")?.status).toBe("ready");
      expect(report.sections.find((section: { id: string }) => section.id === "operator-readiness")?.status).toBe("ready");
      expect(JSON.stringify(report)).not.toContain("private-admin-token");
      expect(report.proofBoundary).toContain("public-surface lockdown only");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("blocks when an internal API is exposed signed out", async () => {
    const baseUrl = await startFixtureServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");

      if (url.pathname === "/" || url.pathname === "/demo/customer") {
        html(response, 200, "<main>Customer page</main>");
        return;
      }

      if (
        url.pathname === "/api/xprize/judge-access-pack" ||
        url.pathname === "/api/xprize/submission-gate" ||
        url.pathname === "/api/compliance/claims"
      ) {
        json(response, 200, { ok: true });
        return;
      }

      if (url.pathname === "/admin") {
        html(response, 200, '<main class="admin-unlock-shell">Admin console locked</main>', {
          "cache-control": "no-store"
        });
        return;
      }

      if (url.pathname === "/api/readiness") {
        json(response, 200, { internal: "leaked" }, { "cache-control": "no-store" });
        return;
      }

      json(response, 401, { ok: false }, { "cache-control": "no-store" });
    });
    const result = await runVerifier(["--url", baseUrl, "--strict"]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('"overallStatus": "blocked"');
    expect(result.stdout).toContain("Signed-out access blocked");
  });

  it("blocks when admin dashboard copy is visible before unlock", async () => {
    const baseUrl = await startFixtureServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");

      if (url.pathname === "/" || url.pathname === "/demo/customer") {
        html(response, 200, "<main>Customer page</main>");
        return;
      }

      if (
        url.pathname === "/api/xprize/judge-access-pack" ||
        url.pathname === "/api/xprize/submission-gate" ||
        url.pathname === "/api/compliance/claims"
      ) {
        json(response, 200, { ok: true });
        return;
      }

      if (url.pathname === "/admin") {
        html(response, 200, "<main><h1>Readiness Command Center</h1></main>", { "cache-control": "no-store" });
        return;
      }

      json(response, 401, { ok: false }, { "cache-control": "no-store" });
    });
    const result = await runVerifier(["--url", baseUrl, "--strict"]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Internal dashboard hidden signed out");
  });
});

function runVerifier(args: string[]) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/verify-hosted-lockdown.mjs", ...args], {
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
    child.on("close", (status) => resolve({ status, stdout: stdout.join(""), stderr: stderr.join("") }));
  });
}

async function startFixtureServer(handler: RouteHandler) {
  const server = createServer(handler);

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

function html(response: ServerResponse, status: number, body: string, headers: Record<string, string> = {}) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
  response.end(body);
}

function json(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}
