/* global process */

import { runWithStableNode } from "./node-runner.mjs";

runWithStableNode("node_modules/vitest/vitest.mjs", ["run", ...process.argv.slice(2)]);
