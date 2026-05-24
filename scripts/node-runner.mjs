/* global console, process */

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

export function resolveStableNode() {
  if (majorVersion(process.version) === 20) {
    return process.execPath;
  }

  const npxCache = join(homedir(), ".npm", "_npx");
  const cachedNode = findCachedNode20(npxCache);

  return cachedNode ?? process.execPath;
}

export function runWithStableNode(scriptPath, args) {
  const nodePath = resolveStableNode();
  const result = spawnSync(nodePath, [scriptPath, ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit"
  });

  if (result.error) {
    console.error(result.error.message);
    process.exitCode = 1;
    return;
  }

  process.exitCode = result.status ?? 1;
}

function findCachedNode20(npxCache) {
  if (!existsSync(npxCache)) {
    return undefined;
  }

  for (const entry of readdirSync(npxCache, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const candidate = join(npxCache, entry.name, "node_modules", "node", "bin", "node");
    if (existsSync(candidate) && majorVersion(readNodeVersion(candidate)) === 20) {
      return candidate;
    }
  }

  return undefined;
}

function readNodeVersion(nodePath) {
  try {
    return execFileSync(nodePath, ["-v"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
}

function majorVersion(version) {
  const match = version.match(/^v?(\d+)/u);
  return match ? Number(match[1]) : 0;
}
