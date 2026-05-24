/* global process */

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runWithStableNode } from "./node-runner.mjs";

const testTempDir = join(process.cwd(), ".tmp", "vitest");

rmSync(testTempDir, { recursive: true, force: true });
mkdirSync(testTempDir, { recursive: true });

process.env.TMPDIR = testTempDir;
process.env.TMP = testTempDir;
process.env.TEMP = testTempDir;

const passthroughArgs = process.argv.slice(2);
const hasTestTimeout = passthroughArgs.some((arg) => arg === "--testTimeout" || arg.startsWith("--testTimeout="));
const hasHookTimeout = passthroughArgs.some((arg) => arg === "--hookTimeout" || arg.startsWith("--hookTimeout="));
const timeoutArgs = [
  ...(hasTestTimeout ? [] : ["--testTimeout=30000"]),
  ...(hasHookTimeout ? [] : ["--hookTimeout=30000"])
];

runWithStableNode("node_modules/vitest/vitest.mjs", ["run", ...timeoutArgs, ...passthroughArgs]);

rmSync(testTempDir, { recursive: true, force: true });
