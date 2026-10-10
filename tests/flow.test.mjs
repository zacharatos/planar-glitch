// A death, start to finish, against a small in-memory fake of Foundry and dnd5e.
// It checks the module's own bookkeeping (records, glitch features, undo data, the body, flags);
// it can't check how Foundry or dnd5e render or apply anything. That part is the manual checklist.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* ---------------- a tiny fake of Foundry ---------------- */

let nextId = 1;
const newId = () => `id${String(nextId++).padStart(13, "0")}`;
const clone = v => structuredClone(v);
const getProp = (o, p) => p.split(".").reduce((x, k) => x?.[k], o);
const setProp = (o, p, v) => { const ks = p.split("."); const last = ks.pop(); let x = o; for (const k of ks) x = x[k] ??= {}; x[last] = v; };
function applyDotted(target, changes) {
  for (const [k, v] of Object.entries(changes)) {
    if (k.includes(".")) setProp(target, k, v);
    else if (v && typeof v === "object" && !Array.isArray(v)) { target[k] ??= {}; applyDotted(target[k], v); }
    else target[k] = v;
  }
}
class Collection extends Map {
  [Symbol.iterator]() { return this.values(); } // Foundry's Collection iterates values
  get contents() { return [...this.values()]; }
  filter(fn) { return this.contents.filter(fn); }
  find(fn) { return this.contents.find(fn); }
  map(fn) { return this.contents.map(fn); }
  some(fn) { return this.contents.some(fn); }
}
const flagsMixin = Base => class extends Base {
  getFlag(scope, key) { return clone(this.flags?.[scope]?.[key]); }
  async setFlag(scope, key, v) { ((this.flags ??= {})[scope] ??= {})[key] = clone(v); return this; }
  async unsetFlag(scope, key) { delete this.flags?.[scope]?.[key]; return this; }
};

class FakeItem extends flagsMixin(Object) {
  constructor(data, parent) {
    super();
    Object.assign(this, clone(data));
    this.id = data._id ?? newId();
    this.parent = parent;
    this.system ??= {};
    this.flags ??= {};
    this._source = { system: clone(this.system) };
  }
  get actor() { return this.parent; }
  toObject() { const { parent, id, _source, ...rest } = this; return clone({ ...rest, _id: id }); }
  async update(changes) { applyDotted(this.system, Object.fromEntries(Object.entries(changes).map(([k, v]) => [k.replace(/^system\./, ""), v]))); this._source.system = clone(this.system); return this; }
  async delete() { this.parent.items.delete(this.id); return this; }
}

class FakeActor extends flagsMixin(Object) {
  constructor(data) {
    super();
    Object.assign(this, clone({ ...data, items: undefined }));
    this.id = data._id ?? newId();
    this.documentName = "Actor";
    this.items = new Collection();
    for (const i of data.items ?? []) { const it = new FakeItem(i, this); this.items.set(it.id, it); }
    this.statuses = new Set(data.statuses ?? []);
    this.flags ??= {};
    this.effects = new Collection();
  }
  get hasPlayerOwner() { return this.type === "character"; }
  async createEmbeddedDocuments(type, list, { keepId } = {}) {
    return list.map(d => { const it = new FakeItem(keepId ? d : { ...d, _id: undefined }, this); this.items.set(it.id, it); return it; });
  }
  async deleteEmbeddedDocuments(type, ids) { for (const id of ids) this.items.delete(id); }
  async update(changes) { applyDotted(this, Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v]))); return this; }
  async toggleStatusEffect(id, { active }) { if (active) this.statuses.add(id); else this.statuses.delete(id); }
  testUserPermission() { return true; }
  async longRest() { this.rested = true; }
  async getTokenDocument(data) { return { toObject: () => ({ ...data, actorId: this.id, actorLink: true, name: this.name }) }; }
}

class FakeToken {
  constructor(data, parent) {
    Object.assign(this, clone(data));
    this.id = newId();
    this.parent = parent;
    this.flags ??= {};
    // An unlinked token gets its own copy of the actor (a synthetic actor).
    if (!this.actorLink) this.actor = new FakeActor({ ...game.actors.get(this.actorId).source(), _id: newId() });
    else this.actor = game.actors.get(this.actorId);
    this.uuid = `Scene.${parent.id}.Token.${this.id}`;
  }
  toObject() { const { parent, actor, uuid, id, ...rest } = this; return clone({ ...rest, _id: id }); }
  async update(changes) { applyDotted(this, changes); return this; }
  async delete() { this.parent.tokens.delete(this.id); }
}

const scene = { id: "scene1", name: "Mortuary basement", tokens: new Collection() };
scene.createEmbeddedDocuments = async (type, list) => list.map(d => { const tk = new FakeToken(d, scene); scene.tokens.set(tk.id, tk); return tk; });

const settings = new Map();
const created = { messages: [], journals: [] };
const promptHandlers = {};

globalThis.Hooks = { on() {}, once() {}, callAll() {} };
globalThis.foundry = {
  applications: { api: { ApplicationV2: class { static DEFAULT_OPTIONS = {}; }, DialogV2: class {} } },
  utils: { randomID: newId, deepClone: clone, getProperty: getProp, setProperty: setProp, debounce: fn => fn }
};
globalThis.CONST = { TOKEN_DISPLAY_MODES: { NONE: 0 }, DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3, NONE: 0 }, JOURNAL_ENTRY_PAGE_FORMATS: { MARKDOWN: 2 } };
globalThis.CONFIG = {
  specialStatusEffects: { DEFEATED: "dead" },
  DND5E: {
    abilities: { str: { label: "Strength" }, dex: { label: "Dexterity" }, con: { label: "Constitution" }, int: { label: "Intelligence" }, wis: { label: "Wisdom" }, cha: { label: "Charisma" } },
    skills: { ath: { label: "Athletics" }, prc: { label: "Perception" }, ste: { label: "Stealth" } },
    languages: { standard: { label: "Standard", children: { common: "Common", elvish: "Elvish", dwarvish: "Dwarvish" } }, exotic: { label: "Exotic", children: { draconic: "Draconic" } }, cant: "Thieves' Cant" },
    damageTypes: { fire: { label: "Fire" }, cold: { label: "Cold" }, acid: { label: "Acid" } },
    featureTypes: {}
  }
};
globalThis.canvas = { scene };
globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };
globalThis.ChatMessage = { create: async d => { created.messages.push(d); return d; }, getSpeaker: () => ({}) };
globalThis.Roll = class { constructor() { this.total = Roll.next ?? 10; } async evaluate() { return this; } async toMessage() {} };
globalThis.fromUuid = async uuid => scene.tokens.find(t => t.uuid === uuid) ?? null;
globalThis.JournalEntry = { create: async d => { created.journals.push(d); return { pages: { contents: [{ uuid: "JournalEntry.j.JournalEntryPage.p", update: async () => {} }] } }; } };
globalThis.Folder = { create: async d => ({ id: "f1", ...d }) };

const gmUser = { id: "gm", isGM: true, active: true, name: "Timos" };
const player = { id: "p1", isGM: false, active: true, name: "Player", character: null, update: async () => {} };
const users = [gmUser, player];
globalThis.game = {
  user: gmUser,
  users: Object.assign(users, { activeGM: { isSelf: true }, get: id => users.find(u => u.id === id), filter: fn => Array.prototype.filter.call(users, fn) }),
  actors: null,
  combats: Object.assign([], { get: () => null, find: () => undefined }),
  scenes: { contents: [scene], get: id => (id === scene.id ? scene : null) },
  folders: { find: () => null },
  modules: new Map([["planar-glitch", {}]]),
  time: { worldTime: 0 },
  settings: {
    register: (mod, key, cfg) => { if (!settings.has(key)) settings.set(key, cfg.default); },
    get: (mod, key) => clone(settings.get(key)),
    set: async (mod, key, v) => settings.set(key, clone(v))
  },
  socket: { on() {}, emit() {} },
  i18n: { localize: k => k, format: (k, d) => `${k}${d ? JSON.stringify(d) : ""}`, lang: "en" }
};

const heroData = {
  name: "Kestrel Vane", type: "character", img: "k.webp",
  prototypeToken: { width: 1, height: 1 },
  system: {
    details: { level: 3 },
    abilities: { str: { value: 15 }, dex: { value: 14 }, con: { value: 13 }, int: { value: 10 }, wis: { value: 12 }, cha: { value: 8 } },
    skills: { ath: { value: 1 }, prc: { value: 1 }, ste: { value: 0 } },
    traits: { languages: { value: ["common", "draconic"] }, dr: { value: [] }, dv: { value: [] }, di: { value: [] } },
    attributes: { hp: { value: 0, max: 28, tempmax: 0 }, death: { success: 1, failure: 3 }, senses: { ranges: { darkvision: 60 } } }
  },
  items: [
    { _id: "rope000000000001", name: "Rope", type: "equipment", system: { quantity: 1 } },
    { _id: "sword00000000001", name: "Greatsword", type: "weapon", system: { quantity: 1, attuned: true, rarity: "uncommon", properties: ["mgc"] } },
    { _id: "manifest00000001", name: "The Manifest", type: "loot", system: { quantity: 1 } },
    { _id: "mm00000000000001", name: "Magic Missile", type: "spell", system: { level: 1 } },
    { _id: "tough00000000001", name: "Tough", type: "feat", system: { type: { value: "feat" } } },
    { _id: "breath0000000001", name: "Breath Weapon", type: "feat", system: { type: { value: "race" }, uses: { max: 2 } } }
  ]
};
FakeActor.prototype.source = function () { return { ...clone(heroData), _id: undefined }; };
const hero = new FakeActor({ ...heroData, _id: "hero000000000001" });
hero.items.get("breath0000000001")._source.system.uses.max = "@prof";
const actors = new Collection([[hero.id, hero]]);
game.actors = actors;
player.character = hero;

const { registerSettings } = await import("../scripts/settings.mjs");
registerSettings();
const state = await import("../scripts/state.mjs");
const catalogData = JSON.parse(readFileSync(new URL("../data/default-catalog.json", import.meta.url), "utf8"));
globalThis.fetch = async () => ({ json: async () => catalogData });
await state.loadDefaultCatalog();
const rpc = await import("../scripts/rpc.mjs");
rpc.onPrompt("wheel", async payload => promptHandlers.wheel(payload));
const deaths = await import("../scripts/deaths.mjs");
const apply = await import("../scripts/apply.mjs");

await scene.createEmbeddedDocuments("Token", [{ actorId: hero.id, actorLink: true, name: hero.name, x: 200, y: 300, texture: { src: "k.webp" } }]);
const heroToken = () => scene.tokens.find(t => t.actorLink && t.actorId === hero.id);

/* ---------------- the tests ---------------- */

test("a death: record, hidden token, empty grey body left where they fell", async () => {
  const rec = await deaths.recordDeath(hero, { cause: "furnace" });
  assert.equal(rec.status, "dead");
  assert.equal(rec.deathNo, 1);
  assert.equal(rec.userId, "p1");
  assert.equal(heroToken().hidden, true);
  const body = scene.tokens.get(rec.corpseTokenId);
  assert.ok(body);
  assert.equal(body.actorLink, false);
  assert.equal(body.x, 200);
  assert.equal(body.actor.items.size, 0, "the body carries nothing");
  assert.ok(body.actor.statuses.has("dead"));
  assert.ok(body.getFlag ? true : body.flags["planar-glitch"].corpse);
  assert.equal(await deaths.recordDeath(hero), null, "one open death per character");
});

test("the GM rolls the Wheel: two tier-I candidates, roleplay only", async () => {
  const rec = state.records()[0];
  Roll.next = 10;
  await deaths.startWheel(rec.id, { byGM: true });
  const r = state.record(rec.id);
  assert.equal(r.status, "rolled");
  assert.deepEqual({ roll: r.wheel.roll, tier: r.wheel.tier }, { roll: 10, tier: 1 });
  assert.equal(r.candidates.length, 2);
  assert.ok(r.candidates.every(c => c.plan.kind === "note" && c.text && c.title));
  await assert.rejects(deaths.accept(rec.id), /PickFirst/);
  await deaths.setChoice(rec.id, 1);
  await deaths.accept(rec.id);
  assert.equal(state.record(rec.id).status, "accepted");
});

test("return: a tagged glitch feature, life restored, the ladder moves", async () => {
  const rec = state.records()[0];
  const chosen = state.record(rec.id).candidates[1];
  const out = await deaths.returnCharacter(rec.id);
  assert.equal(out.status, "returned");
  const g = hero.items.get(out.glitches[0].itemId);
  assert.equal(g.name, chosen.title);
  assert.equal(g.type, "feat");
  assert.equal(g.system.type.value, "glitch");
  assert.equal(g.getFlag("planar-glitch", "glitch").deathNo, 1);
  assert.equal(g.effects.length, 0, "a note has no Active Effect");
  assert.equal(hero.getFlag("planar-glitch", "deaths"), 1);
  assert.equal(hero.system.attributes.hp.value, 28);
  assert.equal(hero.system.attributes.death.failure, 0);
  assert.equal(hero.rested, undefined, "default return keeps resources spent");
  await deaths.markPlaced(rec.id);
  assert.equal(heroToken().hidden, false);
  assert.ok(created.messages.some(m => m.whisper.includes("p1")), "the player is whispered the glitch");
});

test("the player's Wheel: they roll a 1, the tier worsens, they choose", async () => {
  hero.system.attributes.death.failure = 3;
  const rec = await deaths.recordDeath(hero, { cause: "the golem" });
  assert.equal(rec.deathNo, 2);
  let seen = null;
  promptHandlers.wheel = async payload => {
    assert.equal(payload.tier, 2);
    seen = await rpc.call("candidates", { recordId: payload.recordId, roll: 1 });
    return { choice: 0 };
  };
  // The player is "this" user for the prompt in the fake, so route the prompt locally.
  const realGet = game.users.get;
  game.users.get = id => (id === "p1" ? { ...player, id: "gm" } : realGet(id));
  await deaths.startWheel(rec.id);
  game.users.get = realGet;
  const r = state.record(rec.id);
  assert.equal(seen.wheel.tier, 3, "a 1 makes the 2nd death a tier III");
  assert.equal(seen.candidates.length, 2);
  assert.equal(r.status, "rolled");
  assert.equal(r.choice, 0);
  assert.equal(r.pickedBy, "player");
});

test("the GM swaps in 'left behind': the item waits on the body and can be recovered", async () => {
  const rec = state.records().find(r => r.deathNo === 2);
  await deaths.chooseEntry(rec.id, 0, "left-behind");
  const c = state.record(rec.id).candidates[0];
  assert.equal(c.entryId, "left-behind");
  const lostId = c.plan.ops[0].itemId;
  await deaths.accept(rec.id);
  const out = await deaths.returnCharacter(rec.id, { mode: "rested" });
  assert.equal(hero.rested, true);
  assert.equal(hero.items.get(lostId), undefined, "gone from the sheet");
  const body = scene.tokens.get(rec.corpseTokenId);
  assert.equal(body.actor.items.size, 1, "waiting on the body");
  const glitch = hero.items.get(out.glitches[0].itemId);
  const waiting = apply.waitingItems(hero);
  assert.equal(waiting.length, 1);
  assert.equal(await apply.recover(hero, glitch, waiting[0].index), true);
  assert.ok(hero.items.get(lostId), "back on the sheet with the same id");
  assert.equal(body.actor.items.size, 0);
  assert.equal(apply.waitingItems(hero).length, 0);
});

test("the nexus is never offered", async () => {
  await hero.setFlag("planar-glitch", "nexus", ["manifest00000001"]);
  const { actorInfo } = await import("../scripts/actor.mjs");
  const { poolsFor } = await import("../scripts/util.mjs");
  const pool = poolsFor(catalogData.glitches.find(g => g.id === "swallowed"), actorInfo(hero)).items.map(i => i.id);
  assert.ok(!pool.includes("manifest00000001"));
});

test("an ability glitch becomes an Active Effect; Mend removes everything", async () => {
  hero.system.attributes.death.failure = 3;
  const rec = await deaths.recordDeath(hero);
  assert.equal(rec.deathNo, 3);
  await deaths.startWheel(rec.id, { byGM: true });
  await deaths.chooseEntry(rec.id, 0, "faded");
  await deaths.accept(rec.id);
  const out = await deaths.returnCharacter(rec.id);
  const g = hero.items.get(out.glitches[0].itemId);
  const fx = g.effects[0];
  assert.equal(fx.transfer, true);
  assert.equal(fx.changes.length, 1);
  assert.match(fx.changes[0].key, /^system\.abilities\.\w+\.value$/);
  assert.equal(fx.changes[0].value, "-1");
  assert.equal(fx.changes[0].priority, 53);
  await apply.mend(hero, g);
  assert.equal(hero.items.get(g.id), undefined);
});

test("Active Effect changes use V14's system.changes with string types, the older shape before V14", () => {
  const changes = [{ key: "system.abilities.wis.value", mode: 2, value: "-1" }, { key: "system.traits.languages.value", mode: 5, value: '["common"]' }];
  assert.deepEqual(apply.effectChanges(changes, 52, 14), { system: { changes: [
    { key: "system.abilities.wis.value", type: "add", value: "-1", priority: 52 },
    { key: "system.traits.languages.value", type: "override", value: '["common"]', priority: 52 }
  ] } });
  assert.deepEqual(apply.effectChanges(changes, 52, 13).changes.map(c => c.mode), [2, 5]);
});

test("unattune and fewer uses are undone exactly by Mend", async () => {
  const { resolve: resolvePlan } = await import("../scripts/util.mjs");
  const { actorInfo } = await import("../scripts/actor.mjs");
  const record = { id: "r-x", deathNo: 4 };
  for (const id of ["unbound", "blunted"]) {
    const e = catalogData.glitches.find(g => g.id === id);
    const plan = resolvePlan(e, actorInfo(hero), { deathNo: 4 });
    const res = await apply.applyGlitch(hero, { candidate: { plan, title: id, text: "x" }, record, tierLabel: "IV" });
    const target = hero.items.get(plan.ops[0].itemId);
    assert.ok(target.getFlag("planar-glitch", "touched"), "tagged as changed");
    if (id === "unbound") assert.equal(target.system.attuned, false);
    else assert.equal(target.system.uses.max, "(@prof) - 1");
    await apply.mend(hero, hero.items.get(res.itemId));
    if (id === "unbound") assert.equal(target.system.attuned, true);
    else assert.equal(target.system.uses.max, "@prof");
    assert.equal(target.getFlag("planar-glitch", "touched"), undefined);
  }
});

test("raised before the return: no glitch, body gone, token back where the body lay", async () => {
  hero.system.attributes.death.failure = 3;
  hero.system.attributes.hp.value = 0;
  const rec = await deaths.recordDeath(hero);
  const body = scene.tokens.get(rec.corpseTokenId);
  body.x = 450;
  const before = hero.items.size;
  await deaths.raised(rec.id);
  assert.equal(state.record(rec.id).status, "raised");
  assert.equal(scene.tokens.get(rec.corpseTokenId), undefined);
  assert.equal(heroToken().hidden, false);
  assert.equal(heroToken().x, 450);
  assert.equal(hero.items.size, before);
  assert.equal(hero.system.attributes.death.failure, 0);
  assert.equal(hero.system.attributes.hp.value, 1);
});

test("cancel drops the death from the ladder and the log", async () => {
  hero.system.attributes.death.failure = 3;
  const rec = await deaths.recordDeath(hero);
  await deaths.cancelDeath(rec.id);
  assert.equal(state.record(rec.id).status, "cancelled");
  const { trackerMarkdown } = await import("../scripts/tracker.mjs");
  const md = trackerMarkdown();
  assert.ok(!md.includes(rec.id));
  assert.equal(md.split("\n").filter(l => l.startsWith("| 20")).length, 4, "returned ×3 + raised ×1");
});

test("Unity of Self: keep marks the glitch; release (Mend) undoes it", async () => {
  const items = hero.items.filter(i => i.getFlag("planar-glitch", "glitch"));
  assert.equal(items.length, 2);
  await apply.keep(items[0]);
  assert.ok(items[0].getFlag("planar-glitch", "glitch").kept);
  await apply.mend(hero, items[1]);
  assert.equal(hero.items.filter(i => i.getFlag("planar-glitch", "glitch")).length, 1);
});

test("an item dropped on a record comes back with them, and goes again on Mend", async () => {
  const g = hero.items.find(i => i.getFlag("planar-glitch", "glitch"));
  const rec = { id: "r-born", deathNo: 1 };
  const born = await apply.giveBorn(hero, { name: "Strange Key", type: "loot", system: {} }, { record: rec, glitchItem: g });
  assert.ok(born.getFlag("planar-glitch", "touched").born);
  await apply.mend(hero, hero.items.get(g.id));
  assert.equal(hero.items.get(born.id), undefined);
});
