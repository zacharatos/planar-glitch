// Loads the real entry point against stubbed Foundry globals. This catches broken imports, missing
// exports and hook wiring mistakes; it does not replace testing in Foundry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const hooks = { once: {}, on: {} };
globalThis.Hooks = {
  once: (name, fn) => { hooks.once[name] = fn; },
  on: (name, fn) => { (hooks.on[name] ??= []).push(fn); },
  callAll: () => true
};
class FakeApp { static DEFAULT_OPTIONS = {}; }
globalThis.foundry = {
  applications: { api: { ApplicationV2: FakeApp, DialogV2: class {} } },
  utils: { randomID: () => "abc123", deepClone: v => structuredClone(v), getProperty: (o, p) => p.split(".").reduce((x, k) => x?.[k], o), setProperty() {}, debounce: fn => fn }
};
globalThis.CONFIG = { DND5E: { featureTypes: { feat: { label: "Feat" } } }, specialStatusEffects: { DEFEATED: "dead" } };
const settings = new Map();
const registered = { settings: [], keys: [], sockets: [] };
globalThis.game = {
  user: { isGM: true, id: "gm" },
  users: { activeGM: { isSelf: true }, filter: () => [], get: () => null },
  actors: Object.assign([], { get: () => null, filter: () => [] }),
  combats: Object.assign([], { get: () => null }),
  scenes: { contents: [], get: () => null },
  modules: new Map([["planar-glitch", {}]]),
  settings: {
    register: (mod, key, cfg) => { registered.settings.push(`${mod}.${key}`); settings.set(key, cfg.default); },
    get: (mod, key) => settings.get(key),
    set: async (mod, key, v) => settings.set(key, v)
  },
  keybindings: { register: (mod, key) => registered.keys.push(`${mod}.${key}`) },
  socket: { on: event => registered.sockets.push(event), emit() {} },
  i18n: { localize: k => k, format: k => k, lang: "en" }
};
const catalog = JSON.parse(readFileSync(new URL("../data/default-catalog.json", import.meta.url), "utf8"));
globalThis.fetch = async () => ({ json: async () => catalog });
globalThis.ui = { notifications: { warn() {}, info() {}, error() {} }, controls: { render() {} } };

await import("../scripts/main.mjs");

test("registers settings, the glitch feature type and a keybinding on init", () => {
  hooks.once.init();
  for (const k of ["records", "pack", "trackerPage", "detectSaves", "detectDead", "autoOpen", "askPlayer", "wheel", "defaultReturn", "corpse", "textLanguage", "trackerName", "padDeath", "padReturn", "fx"]) {
    assert.ok(registered.settings.includes(`planar-glitch.${k}`), k);
  }
  assert.deepEqual(registered.keys, ["planar-glitch.open"]);
  assert.equal(CONFIG.DND5E.featureTypes.glitch.label, "PLANAR_GLITCH.FeatureType");
});

test("exposes an api on ready, listens on the module socket and watches for deaths", async () => {
  await hooks.once.ready();
  const api = game.modules.get("planar-glitch").api;
  assert.deepEqual(registered.sockets, ["module.planar-glitch"]);
  for (const fn of ["open", "recordDeath", "glitches", "mend", "endGlitch", "records", "catalog", "playFx"]) assert.equal(typeof api[fn], "function", fn);
  assert.equal(api.catalog().glitches.length, catalog.glitches.length, "uses the shipped catalog");
  assert.deepEqual(api.records(), []);
  for (const h of ["updateActor", "createActiveEffect", "deleteCombat", "dnd5e.restCompleted"]) assert.ok(hooks.on[h]?.length, h);
});

test("toolbar button only for the GM", () => {
  const gm = { tokens: { tools: {} } };
  hooks.on.getSceneControlButtons[0](gm);
  assert.ok(gm.tokens.tools["planar-glitch"]);
  game.user.isGM = false;
  const player = { tokens: { tools: {} } };
  hooks.on.getSceneControlButtons[0](player);
  assert.deepEqual(player.tokens.tools, {});
  game.user.isGM = true;
  assert.doesNotThrow(() => hooks.on.getSceneControlButtons[0]({}));
});

test("detection ignores tokens, NPCs and saves below three", () => {
  const [onUpdate] = hooks.on.updateActor.filter((_, i) => i === hooks.on.updateActor.length - 1);
  const npc = { type: "npc", hasPlayerOwner: false };
  const pc = { type: "character", hasPlayerOwner: true, isToken: false };
  for (const fn of hooks.on.updateActor) {
    assert.doesNotThrow(() => fn(npc, { system: { attributes: { death: { failure: 3 } } } }));
    assert.doesNotThrow(() => fn(pc, { system: { attributes: { death: { failure: 2 } } } }));
    assert.doesNotThrow(() => fn({ ...pc, isToken: true }, { system: { attributes: { death: { failure: 3 } } } }));
  }
  assert.ok(onUpdate);
  for (const fn of hooks.on.createActiveEffect) {
    assert.doesNotThrow(() => fn({ parent: { documentName: "Actor", isToken: true }, statuses: new Set(["dead"]) }));
    assert.doesNotThrow(() => fn({ parent: { documentName: "Item" }, statuses: new Set(["dead"]) }));
  }
});

test("item hooks ignore items that aren't glitches", () => {
  for (const name of ["createItem", "updateItem", "deleteItem"]) {
    for (const fn of hooks.on[name]) assert.doesNotThrow(() => fn({ getFlag: () => undefined }, {}, {}));
  }
});

test("sheet decoration ignores non-actor apps", () => {
  for (const fn of hooks.on.renderActorSheetV2) {
    assert.doesNotThrow(() => fn({ document: { documentName: "Item" } }, {}));
    assert.doesNotThrow(() => fn({}, null));
  }
});
