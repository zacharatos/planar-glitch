import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  tierForDeath, wheelTier, validateCatalog, mergeCatalogs, localText, namesMatch, remindersFor,
  poolsFor, isApplicable, pickCandidates, resolve, fillText, labelVars, logMarkdown, tally,
  sortRecords, seeded, sample, nextDeathNo, isOpen, MODES, ABILITY_FLOOR, KINDS, escapeHTML
} from "../scripts/util.mjs";

const catalog = JSON.parse(readFileSync(new URL("../data/default-catalog.json", import.meta.url), "utf8"));

/** A level-3 fighter-ish snapshot, like actorInfo() builds in Foundry. */
const hero = (over = {}) => ({
  name: "Nanouk Wiedzmin",
  level: 3,
  abilities: { str: 15, dex: 10, con: 14, int: 16, wis: 10, cha: 9 },
  skills: { ath: 1, prc: 1, ste: 0, arc: 0, his: 2 },
  languages: ["common", "draconic"],
  dr: ["fire"], dv: [], di: [],
  darkvision: 60,
  glitchIds: [],
  items: [
    { id: "sw", name: "Greatsword", type: "weapon", quantity: 1, magic: true, attuned: true },
    { id: "un", name: "Unarmed Strike", type: "weapon", quantity: 1, unarmed: true },
    { id: "rope", name: "Rope", type: "equipment", quantity: 1 },
    { id: "nx", name: "The Manifest", type: "loot", quantity: 1, nexus: true },
    { id: "mm", name: "Magic Missile", type: "spell", level: 1 },
    { id: "rf", name: "Ray of Frost", type: "spell", level: 0 },
    { id: "bw", name: "Breath Weapon", type: "feat", featType: "race", usesMax: 2, usesSource: "@prof" },
    { id: "sw2", name: "Second Wind", type: "feat", featType: "class", usesMax: 2, usesSource: "@scale.fighter.second-wind" },
    { id: "tough", name: "Tough", type: "feat", featType: "feat" },
    { id: "g1", name: "Glitch: Spoke", type: "feat", featType: "glitch", glitch: true }
  ],
  ...over
});
const byId = id => catalog.glitches.find(g => g.id === id);

test("the shipped catalog is valid and covers every tier with every text in en and el", () => {
  assert.deepEqual(validateCatalog(catalog), []);
  for (let tier = 1; tier <= 5; tier++) assert.ok(catalog.glitches.filter(g => g.tier === tier).length >= 5, `tier ${tier}`);
  for (const g of catalog.glitches) {
    for (const lang of ["en", "el"]) {
      assert.ok(g.title[lang], `${g.id} title ${lang}`);
      assert.ok(g.text[lang], `${g.id} text ${lang}`);
    }
    // Same placeholders in both languages.
    const holders = s => (s.match(/\{\w+\}/g) ?? []).sort().join();
    assert.equal(holders(g.text.el), holders(g.text.en), `${g.id} placeholders`);
  }
  assert.deepEqual(catalog.tiers.map(t => t.tier), [1, 2, 3, 4, 5]);
});

test("tier I glitches never touch numbers", () => {
  for (const g of catalog.glitches.filter(g => g.tier === 1)) assert.equal(g.kind, "note", g.id);
});

test("ladder: one tier per death, capped at V", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 9].map(tierForDeath), [1, 2, 3, 4, 5, 5, 5]);
  assert.equal(tierForDeath(0), 1);
  assert.equal(tierForDeath("x"), 1);
  assert.equal(nextDeathNo(0), 1);
  assert.equal(nextDeathNo(2), 3);
});

test("the Wheel: 1 worsens, 20 lightens, top tier on a 1 gives two glitches", () => {
  assert.deepEqual(wheelTier(1, 10), { tier: 1, count: 1, shift: 0 });
  assert.deepEqual(wheelTier(1, 1), { tier: 2, count: 1, shift: 1 });
  assert.deepEqual(wheelTier(1, 20), { tier: 1, count: 1, shift: -1 });
  assert.deepEqual(wheelTier(3, 20), { tier: 2, count: 1, shift: -1 });
  assert.deepEqual(wheelTier(5, 1), { tier: 5, count: 2, shift: 1 });
  assert.deepEqual(wheelTier(4, null), { tier: 4, count: 1, shift: 0 });
});

test("validateCatalog reports the problems it finds", () => {
  const bad = { schema: 1, id: "x", glitches: [
    { id: "a", tier: 0, kind: "note", title: "A", text: "a" },
    { id: "a", tier: 1, kind: "nope", title: "", text: "a" },
    { id: "b", tier: 2, kind: "lose-item", title: "B", text: "b", params: { mode: "away" } }
  ], reminders: [{ actor: "", text: "x" }] };
  const errs = validateCatalog(bad).join("\n");
  for (const bit of ["tier must be", "duplicate id", "unknown kind", "title is missing", "params.mode", "reminders[0]"]) assert.match(errs, new RegExp(bit.replace(/[[\]]/g, "\\$&")));
  assert.deepEqual(validateCatalog(null), ["not an object"]);
  assert.match(validateCatalog({ schema: 9, id: "x", glitches: [] }).join(), /schema/);
});

test("mergeCatalogs: pack entries replace by id, add, and can replace the default", () => {
  const pack = { schema: 1, id: "camp", glitches: [
    { id: "faded", tier: 3, kind: "note", title: "Mine", text: "m" },
    { id: "own", tier: 1, kind: "note", title: "Own", text: "o", actors: ["Nanouk"] }
  ], tiers: [{ tier: 1, name: { el: "Τρεμούλιασμα" } }], reminders: [{ actor: "Elaion", text: "Posy" }] };
  const m = mergeCatalogs(catalog, pack);
  assert.equal(m.glitches.find(g => g.id === "faded").title, "Mine");
  assert.equal(m.glitches.find(g => g.id === "own").source, "camp");
  assert.equal(m.glitches.length, catalog.glitches.length + 1);
  assert.equal(m.tiers[0].name.el, "Τρεμούλιασμα");
  assert.equal(m.tiers[0].name.en, "Flicker", "keeps the fields the pack doesn't set");
  assert.equal(mergeCatalogs(catalog, { ...pack, replaceDefault: true }).glitches.length, 2);
  assert.equal(mergeCatalogs(catalog, null).glitches.length, catalog.glitches.length);
  assert.equal(remindersFor(m, "Elaion Dawn").length, 1);
  assert.equal(remindersFor(m, "Nanouk").length, 0);
});

test("localText and namesMatch", () => {
  assert.equal(localText({ en: "a", el: "α" }, "el"), "α");
  assert.equal(localText({ en: "a" }, "el"), "a");
  assert.equal(localText({ de: "x" }, "el"), "x");
  assert.equal(localText("plain", "el"), "plain");
  assert.equal(localText(null), "");
  assert.ok(namesMatch(["Nanouk"], "Nanouk Wiedzmin"));
  assert.ok(namesMatch(["nanouk wiedzmin"], "Nanouk Wiedzmin"));
  assert.ok(!namesMatch(["Lothrik"], "Nanouk Wiedzmin"));
  assert.ok(namesMatch([], "Anyone"));
  assert.ok(namesMatch(undefined, "Anyone"));
});

test("pools never offer the nexus, other glitches, unarmed strikes, cantrips or class features to fade", () => {
  const info = hero();
  const lose = poolsFor(byId("left-behind"), info).items.map(i => i.id);
  assert.deepEqual(lose.sort(), ["rope", "sw"]);
  assert.deepEqual(poolsFor(byId("unmade-gift"), info).items.map(i => i.id), ["sw"]);
  assert.deepEqual(poolsFor(byId("forgotten-spell"), info).items.map(i => i.id), ["mm"]);
  assert.deepEqual(poolsFor(byId("fading-self"), info).items.map(i => i.id), ["tough"]);
  assert.deepEqual(poolsFor(byId("lost-heritage"), info).items.map(i => i.id), ["bw"]);
  assert.deepEqual(poolsFor(byId("blunted"), info).items.map(i => i.id).sort(), ["bw", "sw2"]);
  assert.deepEqual(poolsFor(byId("unbound"), info).items.map(i => i.id), ["sw"]);
});

test("ability glitches respect the floor of 8", () => {
  const info = hero({ abilities: { str: 9, dex: 8, con: 10, int: 8, wis: 8, cha: 8 } });
  assert.deepEqual(poolsFor(byId("faded"), info).abilities, ["str", "con"]);
  assert.deepEqual(poolsFor(byId("cracked"), info).abilities, ["con"]);
  assert.equal(poolsFor(byId("crumbling"), info).ok, false, "needs two abilities that can drop by 2");
  for (let seed = 1; seed < 40; seed++) {
    const plan = resolve(byId("faded"), info, { rng: seeded(seed) });
    assert.ok(plan.vars.to >= ABILITY_FLOOR);
  }
});

test("isApplicable: personal entries only for their actor, no repeats, needs a fitting pool", () => {
  const info = hero();
  assert.ok(isApplicable({ id: "x", kind: "note", actors: ["Nanouk"] }, info));
  assert.ok(!isApplicable({ id: "x", kind: "note", actors: ["Lothrik"] }, info));
  assert.ok(!isApplicable(byId("the-spoke"), { ...info, glitchIds: ["the-spoke"] }));
  assert.ok(isApplicable({ ...byId("the-spoke"), repeatable: true }, { ...info, glitchIds: ["the-spoke"] }));
  assert.ok(!isApplicable(byId("dimmed-eyes"), { ...info, darkvision: 0 }));
  assert.ok(!isApplicable(byId("lost-word"), { ...info, languages: ["common"] }));
  assert.ok(!isApplicable(byId("another-tongue"), info), "no language pool given");
  assert.ok(isApplicable(byId("another-tongue"), info, { languagePool: ["common", "elvish"] }));
});

test("pickCandidates: two distinct fitting glitches, a personal one when there is one, falls back a tier", () => {
  const info = hero();
  for (let seed = 1; seed < 30; seed++) {
    const c = pickCandidates(catalog, 3, info, { rng: seeded(seed) });
    assert.equal(c.length, 2);
    assert.notEqual(c[0].entry.id, c[1].entry.id);
    assert.ok(c.every(x => x.tier === 3 && isApplicable(x.entry, info)));
  }
  const withMine = mergeCatalogs(catalog, { schema: 1, id: "p", glitches: [{ id: "mine", tier: 2, kind: "note", title: "M", text: "m", actors: ["Nanouk"] }] });
  for (let seed = 1; seed < 20; seed++) {
    assert.ok(pickCandidates(withMine, 2, info, { rng: seeded(seed) }).some(c => c.entry.id === "mine"));
  }
  // Nothing fits at tier 5 for a bare actor: fall back to the nearest lower tier that fits.
  const bare = { name: "Bare", level: 0, abilities: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 }, skills: {}, languages: ["common"], dr: [], dv: [], di: [...["acid", "cold", "fire", "force", "lightning", "necrotic", "poison", "psychic", "radiant", "thunder"]], darkvision: 0, items: [], glitchIds: [] };
  const c = pickCandidates(catalog, 5, bare, { rng: seeded(3) });
  assert.ok(c.length > 0);
  assert.ok(c[0].tier < 5);
  assert.equal(pickCandidates({ glitches: [] }, 3, bare).length, 0);
  assert.equal(pickCandidates(catalog, 3, info, { count: 1, rng: seeded(2) }).length, 1);
  const ex = pickCandidates(catalog, 1, info, { exclude: catalog.glitches.filter(g => g.tier === 1).map(g => g.id).slice(1), rng: seeded(5), count: 2 });
  assert.equal(ex.length, 1, "only one tier-I entry left after excluding");
});

test("resolve: ability swap and ability loss produce matching Active Effect changes", () => {
  const info = hero();
  const swap = resolve(byId("rebalanced"), info, { rng: seeded(4) });
  const [a, b] = swap.changes;
  assert.equal(a.mode, MODES.ADD);
  assert.equal(Number(a.value) + Number(b.value), 0);
  const ka = a.key.split(".")[2], kb = b.key.split(".")[2];
  assert.equal(info.abilities[ka] + Number(a.value), info.abilities[kb]);
  assert.ok(Math.abs(info.abilities[ka] - info.abilities[kb]) <= 2);

  const crumble = resolve(byId("crumbling"), info, { rng: seeded(7), deathNo: 5 });
  assert.equal(crumble.changes.length, 2);
  assert.ok(crumble.changes.every(c => c.value === "-2"));
  assert.notEqual(crumble.vars.ability, crumble.vars.ability2);
  assert.equal(crumble.vars.to2, crumble.vars.from2 - 2);
  assert.equal(crumble.priority, 55);
});

test("resolve: skills, languages, damage types, initiative, darkvision, hit points", () => {
  const info = hero();
  const ss = resolve(byId("someone-elses-training"), info, { rng: seeded(1) });
  assert.ok(["ath", "prc", "his"].includes(ss.vars.skill));
  assert.ok(["ste", "arc"].includes(ss.vars.skill2));
  assert.deepEqual(ss.changes.map(c => c.value), ["0", "1"]);

  const lang = resolve(byId("another-tongue"), info, { rng: seeded(2), languagePool: ["common", "draconic", "elvish"] });
  assert.equal(lang.vars.language, "draconic");
  assert.equal(lang.vars.language2, "elvish");
  assert.deepEqual(JSON.parse(lang.changes[0].value), ["common", "elvish"]);
  assert.equal(lang.changes[0].mode, MODES.OVERRIDE);

  const lost = resolve(byId("lost-word"), info, { rng: seeded(2) });
  assert.deepEqual(JSON.parse(lost.changes[0].value), ["common"]);

  const rs = resolve(byId("changed-blood"), info, { rng: seeded(9) });
  assert.notEqual(rs.vars.type, rs.vars.type2);
  assert.ok(rs.vars.type !== "fire" && rs.vars.type2 !== "fire", "never a type the actor already resists");

  assert.equal(resolve(byId("slow-to-wake"), info).changes[0].value, "-2");
  assert.equal(resolve(byId("dimmed-eyes"), info).changes[0].value, "0");
  assert.equal(resolve(byId("hollow"), info).vars.n, 3);
  assert.equal(resolve(byId("deep-hollow"), info).changes[0].value, "-6");
  assert.equal(resolve(byId("dimmed-eyes"), { ...info, darkvision: 0 }), null);
});

test("resolve: item operations carry what's needed to undo them", () => {
  const info = hero();
  const left = resolve(byId("left-behind"), info, { rng: seeded(1) });
  assert.equal(left.ops[0].op, "delete-item");
  assert.equal(left.ops[0].mode, "corpse");
  assert.ok(["rope", "sw"].includes(left.ops[0].itemId));
  assert.equal(resolve(byId("swallowed"), info).ops[0].mode, "gone");
  assert.equal(resolve(byId("forgotten-spell"), info).vars.spell, "Magic Missile");

  const blunt = resolve(byId("blunted"), info, { rng: seeded(3) });
  const op = blunt.ops[0];
  assert.equal(op.op, "update-item");
  assert.match(op.update["system.uses.max"], /^\(.+\) - 1$/);
  assert.equal(op.revert["system.uses.max"], info.items.find(i => i.id === op.itemId).usesSource);
  assert.equal(blunt.vars.to, 1);

  const un = resolve(byId("unbound"), info);
  assert.deepEqual(un.ops[0].update, { "system.attuned": false });
  assert.deepEqual(un.ops[0].revert, { "system.attuned": true });
});

test("every kind in the catalog resolves for a well-stocked actor", () => {
  const info = hero();
  for (const g of catalog.glitches) {
    const plan = resolve(g, info, { rng: seeded(11), languagePool: ["common", "elvish", "dwarvish"] });
    assert.ok(plan, g.id);
    assert.ok(g.kind in KINDS);
  }
});

test("fillText and labelVars", () => {
  const vars = labelVars({ ability: "wis", skill: "ath", language: "elvish", type: "fire", n: 0 },
    { abilities: { wis: "Wisdom" }, skills: { ath: "Athletics" }, languages: { elvish: "Elvish" }, damage: { fire: "Fire" } });
  assert.equal(fillText("{ability} {skill} {language} {type} {n} {missing}", vars), "Wisdom Athletics Elvish Fire 0 {missing}");
  assert.equal(labelVars({ ability: "xyz" }, {}).ability, "xyz");
});

test("log markdown lists deaths oldest first and skips cancelled ones", () => {
  const L = {
    title: "Glitch Tracker", intro: "intro",
    cols: { date: "Date", character: "Character", death: "#", cause: "Died how", where: "Where", wheel: "Wheel", glitch: "Glitch", return: "Return", found: "Found at", fragment: "Fragment" },
    status: { raised: "Raised", replaced: "New character", dead: "Dead" },
    modes: { spent: "Spent", rested: "Rested", wait: "Long rest" },
    tier: n => ["", "I", "II", "III", "IV", "V"][n], none: "—"
  };
  const records = [
    { date: "2026-11-02T20:00:00Z", actorName: "B", deathNo: 1, cause: "fell | hard", sceneName: "Pit", wheel: { roll: 20, rerolled: true }, glitches: [{ title: "Spoke", tier: 1 }], returnMode: "spent", foundAt: "a wardrobe", status: "returned" },
    { date: "2026-11-01T20:00:00Z", actorName: "A", deathNo: 2, status: "raised" },
    { date: "2026-11-03T20:00:00Z", actorName: "C", status: "cancelled" }
  ];
  const md = logMarkdown(records, L);
  assert.match(md, /^# Glitch Tracker/);
  assert.ok(md.indexOf("| 2026-11-01 | A") < md.indexOf("| 2026-11-02 | B"));
  assert.match(md, /fell \\\| hard/);
  assert.match(md, /d20 20\*/);
  assert.match(md, /Spoke \(I\)/);
  assert.match(md, /\| Raised \|/);
  assert.ok(!md.includes("| C |"));
  assert.match(logMarkdown([], L), /\| — \|/);
});

test("tally, sortRecords, isOpen, sample and escapeHTML", () => {
  const recs = [
    { actorId: "a", status: "returned", date: "1" },
    { actorId: "a", status: "raised", date: "2" },
    { actorId: "a", status: "dead", date: "3" },
    { actorId: "a", status: "cancelled", date: "4" },
    { actorId: "b", status: "returned", date: "5" }
  ];
  assert.deepEqual(tally(recs, "a"), { deaths: 3, returned: 1, raised: 1 });
  assert.equal(sortRecords(recs)[0].date, "3", "open records first");
  assert.ok(isOpen({ status: "rolled" }));
  assert.ok(!isOpen({ status: "returned" }));
  assert.equal(new Set(sample([1, 2, 3, 4], 4, seeded(2))).size, 4);
  assert.equal(sample([1, 2], 5).length, 2);
  assert.equal(escapeHTML(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
});
