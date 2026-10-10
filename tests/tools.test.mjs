import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stamp } from "../tools/stamp-manifest.mjs";
import { buildBody } from "../tools/release-api.mjs";

const manifest = JSON.parse(readFileSync(new URL("../module.json", import.meta.url), "utf8"));

test("stamp sets version and GitHub URLs", () => {
  const out = stamp(manifest, { version: "1.2.3", repo: "someone/planar-glitch" });
  assert.equal(out.version, "1.2.3");
  assert.equal(out.manifest, "https://github.com/someone/planar-glitch/releases/latest/download/module.json");
  assert.equal(out.download, "https://github.com/someone/planar-glitch/releases/download/v1.2.3/module.zip");
  assert.equal(out.id, manifest.id);
  assert.ok(!JSON.stringify(out).includes("YOUR_GITHUB_USER"));
});

test("stamp rejects bad input", () => {
  assert.throws(() => stamp(manifest, { version: "v1.2", repo: "a/b" }));
  assert.throws(() => stamp(manifest, { version: "1.2.3", repo: "nope" }));
});

test("release API body points at the versioned manifest", () => {
  const body = buildBody(manifest, { version: "1.2.3", repo: "someone/planar-glitch", dryRun: true });
  assert.equal(body.id, "planar-glitch");
  assert.equal(body["dry-run"], true);
  assert.equal(body.release.manifest, "https://github.com/someone/planar-glitch/releases/download/v1.2.3/module.json");
  assert.ok(!body.release.manifest.includes("latest"));
  assert.equal(body.release.compatibility.minimum, manifest.compatibility.minimum);
});
