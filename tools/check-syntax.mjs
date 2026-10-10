#!/usr/bin/env node
// `node --check` on every .mjs file, so a typo fails CI before it reaches Foundry.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const roots = ["scripts", "tools", "tests"];
let failed = 0, count = 0;
const walk = dir => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".mjs")) {
      count++;
      const r = spawnSync(process.execPath, ["--check", p], { encoding: "utf8" });
      if (r.status !== 0) { failed++; console.error(r.stderr); }
    }
  }
};
roots.forEach(walk);
console.log(`${count} files checked, ${failed} failed`);
process.exit(failed ? 1 : 0);
