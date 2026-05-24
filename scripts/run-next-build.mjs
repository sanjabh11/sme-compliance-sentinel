import { runWithStableNode } from "./node-runner.mjs";

runWithStableNode("node_modules/next/dist/bin/next", ["build", "--webpack"]);
