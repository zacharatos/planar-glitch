#!/usr/bin/env node
// Builds dist/module.zip (files at the zip root, as Foundry expects) and dist/module.json.
//   node tools/package.mjs --version 0.1.0 --repo user/planar-glitch
import { cpSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { stamp } from "./stamp-manifest.mjs";

const argv = process.argv.slice(2);
const arg = name => argv[argv.indexOf(`--${name}`) + 1];
const manifest = JSON.parse(readFileSync("module.json", "utf8"));
const version = arg("version") ?? manifest.version;
const repo = arg("repo");
if (!repo) { console.error("Usage: package.mjs --repo user/name [--version 1.2.3]"); process.exit(1); }

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/stage", { recursive: true });
const stamped = stamp(manifest, { version, repo });
writeFileSync("dist/module.json", JSON.stringify(stamped, null, 2) + "\n");
writeFileSync("dist/stage/module.json", JSON.stringify(stamped, null, 2) + "\n");
for (const item of ["scripts", "styles", "lang", "data", "assets", "README.md", "LICENSE", "CHANGELOG.md"]) {
  if (existsSync(item)) cpSync(item, `dist/stage/${item}`, { recursive: true });
}
const zip = spawnSync("zip", ["-r", "-q", "../module.zip", "."], { cwd: "dist/stage" });
if (zip.status !== 0) { console.error("zip failed:", zip.stderr?.toString() || zip.error); process.exit(1); }
rmSync("dist/stage", { recursive: true });
console.log(`dist/module.zip + dist/module.json (v${version})`);
