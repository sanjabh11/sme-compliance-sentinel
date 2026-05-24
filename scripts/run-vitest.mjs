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

runWithStableNode("node_modules/vitest/vitest.mjs", ["run", ...process.argv.slice(2)]);

rmSync(testTempDir, { recursive: true, force: true });
