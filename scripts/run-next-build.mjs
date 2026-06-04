import { runWithStableNode } from "./node-runner.mjs";
import { existsSync, unlinkSync } from "node:fs";

if (existsSync(".next/lock")) {
  unlinkSync(".next/lock");
}

runWithStableNode("node_modules/next/dist/bin/next", ["build", "--webpack"]);
