// Pure rules and helpers. No Foundry globals here: everything is unit-tested in tests/util.test.mjs.
//
// The flow these helpers serve:
//   death count -> tier (tierForDeath) -> the Wheel's d20 shifts it (wheelTier)
//   -> two candidate glitches the character can actually take (pickCandidates)
//   -> one is resolved against the actor's numbers (resolve) into a plan:
//      Active Effect changes + item operations + the values for the text placeholders.
// The Foundry side (apply.mjs) turns a plan into documents and stores what it needs to undo it.

export const CATALOG_SCHEMA = 1;
export const RECORD_SCHEMA = 1;
export const MAX_TIER = 5;

export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
export const DAMAGE_TYPES = ["acid", "cold", "fire", "force", "lightning", "necrotic", "poison", "psychic", "radiant", "thunder"];
/** Ability scores a glitch never pushes below. */
export const ABILITY_FLOOR = 8;

/** Active Effect modes (CONST.ACTIVE_EFFECT_MODES), copied so this file stays Foundry-free. */
export const MODES = { ADD: 2, OVERRIDE: 5 };

/** Every kind a catalog entry can use, with the params it understands. */
export const KINDS = {
  "note": [],
  "ability-down": ["amount", "count"],
  "ability-swap": ["maxGap"],
  "skill-swap": [],
  "skill-lose": [],
  "language-swap": [],
  "language-lose": [],
  "resist-swap": [],
  "vulnerability": [],
  "init-down": ["amount"],
  "darkvision-lose": [],
  "hp-down": ["perLevel"],
  "lose-item": ["mode", "magic"],
  "forget-spell": [],
  "fade-feature": ["types"],
  "fewer-uses": [],
  "unattune": []
};

/** Item types a glitch may take away (never classes, subclasses, species, backgrounds, spells or features). */
export const LOSABLE_TYPES = ["weapon", "equipment", "consumable", "tool", "loot"];

export const RECORD_STATUS = ["dead", "asking", "rolled", "accepted", "returned", "raised", "replaced", "cancelled"];
export const OPEN_STATUS = ["dead", "asking", "rolled", "accepted"];
export const RETURN_MODES = ["spent", "rested", "wait"];

export function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/* ------------------------------------------------------------------ */
/* Randomness                                                          */
/* ------------------------------------------------------------------ */

/** Seeded generator for tests (mulberry32). Foundry code passes Math.random. */
export function seeded(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = (list, rng = Math.random) => list.length ? list[Math.floor(rng() * list.length)] : undefined;

/** Up to n distinct members of a list, in random order. */
export function sample(list, n, rng = Math.random) {
  const pool = [...list];
  const out = [];
  while (pool.length && out.length < n) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}

/* ------------------------------------------------------------------ */
/* The ladder and the Wheel                                            */
/* ------------------------------------------------------------------ */

/** Tier for the nth death of a character (1-based): 1st -> I, 2nd -> II ... 5th and later -> V. */
export function tierForDeath(n) {
  const d = Math.max(1, Math.floor(Number(n) || 1));
  return Math.min(d, MAX_TIER);
}

/**
 * The Wheel: a d20 shifts the tier. 1 = one tier worse (at the top tier: two glitches),
 * 20 = one tier lighter (never below I), anything else = as is. No roll = as is.
 */
export function wheelTier(baseTier, roll) {
  const base = Math.min(Math.max(1, baseTier), MAX_TIER);
  const r = Number(roll);
  if (r === 1) return base === MAX_TIER ? { tier: base, count: 2, shift: 1 } : { tier: base + 1, count: 1, shift: 1 };
  if (r === 20) return { tier: Math.max(1, base - 1), count: 1, shift: -1 };
  return { tier: base, count: 1, shift: 0 };
}

/* ------------------------------------------------------------------ */
/* Catalogs                                                            */
/* ------------------------------------------------------------------ */

const isText = v => typeof v === "string" ? v.trim().length > 0 : !!v && typeof v === "object" && Object.values(v).some(x => typeof x === "string" && x.trim());

/** Check a catalog or pack. Returns a list of problems (empty = fine). */
export function validateCatalog(cat) {
  const errors = [];
  if (!cat || typeof cat !== "object") return ["not an object"];
  if (cat.schema !== CATALOG_SCHEMA) errors.push(`schema must be ${CATALOG_SCHEMA}`);
  if (typeof cat.id !== "string" || !cat.id) errors.push("id is missing");
  if (!Array.isArray(cat.glitches)) errors.push("glitches must be a list");
  const seen = new Set();
  for (const [i, g] of (cat.glitches ?? []).entries()) {
    const where = `glitches[${i}]${g?.id ? ` (${g.id})` : ""}`;
    if (!g || typeof g !== "object") { errors.push(`${where}: not an object`); continue; }
    if (typeof g.id !== "string" || !g.id) errors.push(`${where}: id is missing`);
    else if (seen.has(g.id)) errors.push(`${where}: duplicate id`);
    seen.add(g.id);
    if (!Number.isInteger(g.tier) || g.tier < 1 || g.tier > MAX_TIER) errors.push(`${where}: tier must be 1-${MAX_TIER}`);
    if (!(g.kind in KINDS)) errors.push(`${where}: unknown kind "${g.kind}"`);
    if (!isText(g.title)) errors.push(`${where}: title is missing`);
    if (!isText(g.text)) errors.push(`${where}: text is missing`);
    if (g.actors !== undefined && !Array.isArray(g.actors)) errors.push(`${where}: actors must be a list of names`);
    if (g.kind === "lose-item" && g.params?.mode && !["corpse", "gone"].includes(g.params.mode)) errors.push(`${where}: params.mode must be corpse or gone`);
  }
  for (const [i, r] of (cat.reminders ?? []).entries()) {
    if (!r?.actor || !isText(r.text)) errors.push(`reminders[${i}]: needs actor and text`);
  }
  if (cat.tiers !== undefined && !Array.isArray(cat.tiers)) errors.push("tiers must be a list");
  return errors;
}

/**
 * The active catalog: the shipped one plus an imported pack. Pack entries with the same id replace
 * shipped ones; `pack.replaceDefault: true` drops the shipped entries altogether. Tier names come
 * from the pack when it has them.
 */
export function mergeCatalogs(base, pack) {
  const glitches = new Map();
  if (!pack?.replaceDefault) for (const g of base?.glitches ?? []) glitches.set(g.id, { ...g, source: base.id });
  for (const g of pack?.glitches ?? []) glitches.set(g.id, { ...g, source: pack.id });
  const tiers = new Map((base?.tiers ?? []).map(t => [t.tier, t]));
  const mergeText = (a, b) => (a && b && typeof a === "object" && typeof b === "object" ? { ...a, ...b } : b ?? a);
  for (const t of pack?.tiers ?? []) {
    const old = tiers.get(t.tier) ?? {};
    tiers.set(t.tier, { ...old, ...t, name: mergeText(old.name, t.name), hint: mergeText(old.hint, t.hint) });
  }
  return {
    id: pack?.id ?? base?.id,
    name: pack?.name ?? base?.name,
    tiers: [...tiers.values()].sort((a, b) => a.tier - b.tier),
    glitches: [...glitches.values()],
    reminders: [...(base?.reminders ?? []), ...(pack?.reminders ?? [])]
  };
}

/** Text in the wanted language: plain strings pass through; {en, el} objects fall back to en, then anything. */
export function localText(value, lang = "en") {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return value[lang] ?? value.en ?? Object.values(value).find(v => typeof v === "string") ?? "";
}

const norm = s => String(s ?? "").trim().toLowerCase();

/** Does a name list (from a pack) include this actor? Matches the full name or the first word. */
export function namesMatch(names, actorName) {
  if (!names?.length) return true;
  const full = norm(actorName);
  const first = full.split(/\s+/)[0];
  return names.some(n => { const x = norm(n); return x === full || x === first; });
}

export const isPersonal = entry => !!entry.actors?.length;

export function remindersFor(catalog, actorName) {
  return (catalog?.reminders ?? []).filter(r => namesMatch([r.actor], actorName));
}

/* ------------------------------------------------------------------ */
/* What an actor can take                                              */
/* ------------------------------------------------------------------ */

/*
 * `info` is a plain snapshot of the actor built on the Foundry side (apply.mjs → actorInfo):
 * { name, level, abilities: {str: 15, ...}, skills: {ath: 0, ...}, languages: [..],
 *   dr: [..], dv: [..], di: [..], darkvision: 60,
 *   items: [{ id, name, type, featType, level, attuned, equipped, magic, quantity,
 *             usesMax, usesSource, nexus, glitch, unarmed }],
 *   glitchIds: [catalog ids already on the actor] }
 */

const abilityOk = (info, a, amount) => Number(info.abilities?.[a]) - amount >= ABILITY_FLOOR;
const proficientSkills = info => Object.entries(info.skills ?? {}).filter(([, v]) => Number(v) >= 1).map(([k]) => k);
const unskilled = info => Object.entries(info.skills ?? {}).filter(([, v]) => !Number(v)).map(([k]) => k);
const otherLanguages = info => (info.languages ?? []).filter(l => l !== "common");
const usable = i => !i.nexus && !i.glitch;

function abilityPairs(info, maxGap) {
  const out = [];
  for (let i = 0; i < ABILITIES.length; i++) for (let j = i + 1; j < ABILITIES.length; j++) {
    const a = ABILITIES[i], b = ABILITIES[j];
    const x = Number(info.abilities?.[a]), y = Number(info.abilities?.[b]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const gap = Math.abs(x - y);
    if (gap > 0 && gap <= maxGap) out.push([a, b]);
  }
  return out;
}

/** The pools each kind draws from, for this actor. An empty pool means the glitch doesn't fit. */
export function poolsFor(entry, info, { languagePool = [] } = {}) {
  const p = entry.params ?? {};
  const items = (info.items ?? []).filter(usable);
  switch (entry.kind) {
    case "note": return { ok: true };
    case "ability-down": {
      const amount = p.amount ?? 1, count = p.count ?? 1;
      const abilities = ABILITIES.filter(a => abilityOk(info, a, amount));
      return { ok: abilities.length >= count, abilities };
    }
    case "ability-swap": {
      const pairs = abilityPairs(info, p.maxGap ?? 2);
      return { ok: pairs.length > 0, pairs };
    }
    case "skill-swap": {
      const lose = proficientSkills(info), gain = unskilled(info);
      return { ok: lose.length > 0 && gain.length > 0, lose, gain };
    }
    case "skill-lose": {
      const lose = proficientSkills(info);
      return { ok: lose.length > 0, lose };
    }
    case "language-swap": {
      const lose = otherLanguages(info);
      const gain = languagePool.filter(l => !(info.languages ?? []).includes(l));
      return { ok: lose.length > 0 && gain.length > 0, lose, gain };
    }
    case "language-lose": {
      const lose = otherLanguages(info);
      return { ok: lose.length > 0, lose };
    }
    case "resist-swap": {
      const has = new Set([...(info.dr ?? []), ...(info.dv ?? []), ...(info.di ?? [])]);
      const free = DAMAGE_TYPES.filter(t => !has.has(t));
      return { ok: free.length >= 2, free };
    }
    case "vulnerability": {
      const has = new Set([...(info.dv ?? []), ...(info.di ?? [])]);
      const free = DAMAGE_TYPES.filter(t => !has.has(t));
      return { ok: free.length > 0, free };
    }
    case "init-down": return { ok: true };
    case "darkvision-lose": return { ok: Number(info.darkvision) > 0 };
    case "hp-down": return { ok: Number(info.level) > 0 };
    case "lose-item": {
      const list = items.filter(i => LOSABLE_TYPES.includes(i.type) && !i.unarmed && Number(i.quantity ?? 1) > 0 && (!p.magic || i.magic));
      return { ok: list.length > 0, items: list };
    }
    case "forget-spell": {
      const list = items.filter(i => i.type === "spell" && Number(i.level) >= 1);
      return { ok: list.length > 0, items: list };
    }
    case "fade-feature": {
      const types = p.types ?? ["feat"];
      const list = items.filter(i => i.type === "feat" && types.includes(i.featType));
      return { ok: list.length > 0, items: list };
    }
    case "fewer-uses": {
      const list = items.filter(i => i.type === "feat" && Number(i.usesMax) >= 2 && typeof i.usesSource === "string" && i.usesSource.trim());
      return { ok: list.length > 0, items: list };
    }
    case "unattune": {
      const list = items.filter(i => i.attuned);
      return { ok: list.length > 0, items: list };
    }
    default: return { ok: false };
  }
}

/** Can this actor take this glitch now? (Fits the actor, is for them, and isn't on them already.) */
export function isApplicable(entry, info, opts = {}) {
  if (!namesMatch(entry.actors, info.name)) return false;
  if (!entry.repeatable && (info.glitchIds ?? []).includes(entry.id)) return false;
  return poolsFor(entry, info, opts).ok;
}

/**
 * Candidates for a tier: `count` distinct entries the actor can take. When the tier has personal
 * entries for this actor, one of the candidates is personal. If the tier has nothing that fits,
 * the nearest lower tier is tried, then higher ones.
 */
export function pickCandidates(catalog, tier, info, { count = 2, rng = Math.random, languagePool = [], exclude = [] } = {}) {
  const order = [tier];
  for (let d = 1; d < MAX_TIER; d++) { if (tier - d >= 1) order.push(tier - d); }
  for (let d = 1; d < MAX_TIER; d++) { if (tier + d <= MAX_TIER) order.push(tier + d); }
  for (const t of order) {
    const fit = (catalog?.glitches ?? []).filter(g => g.tier === t && !exclude.includes(g.id) && isApplicable(g, info, { languagePool }));
    if (!fit.length) continue;
    const personal = fit.filter(isPersonal);
    const out = [];
    if (personal.length) out.push(pick(personal, rng));
    for (const g of sample(fit.filter(g => !out.includes(g)), count - out.length, rng)) out.push(g);
    return sample(out, out.length, rng).map(g => ({ entry: g, tier: t }));
  }
  return [];
}

/* ------------------------------------------------------------------ */
/* Resolving a glitch into a plan                                      */
/* ------------------------------------------------------------------ */

const ability = a => `system.abilities.${a}.value`;
const skill = s => `system.skills.${s}.value`;

/**
 * Turn a catalog entry into a concrete plan for this actor.
 * Returns { entryId, tier, kind, vars, changes, ops, priority } where
 *   vars    raw values for the text placeholders (ability/skill/language/type ids, numbers, names);
 *           the Foundry side swaps ids for labels with labelVars()
 *   changes Active Effect changes for the glitch feature ({key, mode, value})
 *   ops     item operations: {op: "delete-item", itemId, mode} | {op: "update-item", itemId, update, revert}
 * Returns null if the entry doesn't fit.
 */
export function resolve(entry, info, { rng = Math.random, languagePool = [], deathNo = 1 } = {}) {
  const pools = poolsFor(entry, info, { languagePool });
  if (!pools.ok) return null;
  const p = entry.params ?? {};
  const plan = { entryId: entry.id, tier: entry.tier, kind: entry.kind, vars: {}, changes: [], ops: [], priority: 50 + deathNo };
  const v = plan.vars;
  switch (entry.kind) {
    case "note": break;
    case "ability-down": {
      const amount = p.amount ?? 1;
      const picked = sample(pools.abilities, p.count ?? 1, rng);
      picked.forEach((a, i) => {
        const key = i === 0 ? "ability" : `ability${i + 1}`;
        v[key] = a;
        v[i === 0 ? "from" : `from${i + 1}`] = Number(info.abilities[a]);
        v[i === 0 ? "to" : `to${i + 1}`] = Number(info.abilities[a]) - amount;
        plan.changes.push({ key: ability(a), mode: MODES.ADD, value: String(-amount) });
      });
      v.n = amount;
      break;
    }
    case "ability-swap": {
      const [a, b] = pick(pools.pairs, rng);
      const x = Number(info.abilities[a]), y = Number(info.abilities[b]);
      Object.assign(v, { ability: a, ability2: b, from: x, to: y });
      plan.changes.push({ key: ability(a), mode: MODES.ADD, value: String(y - x) });
      plan.changes.push({ key: ability(b), mode: MODES.ADD, value: String(x - y) });
      break;
    }
    case "skill-swap": {
      const lose = pick(pools.lose, rng), gain = pick(pools.gain, rng);
      Object.assign(v, { skill: lose, skill2: gain });
      plan.changes.push({ key: skill(lose), mode: MODES.OVERRIDE, value: "0" });
      plan.changes.push({ key: skill(gain), mode: MODES.OVERRIDE, value: "1" });
      break;
    }
    case "skill-lose": {
      const lose = pick(pools.lose, rng);
      v.skill = lose;
      plan.changes.push({ key: skill(lose), mode: MODES.OVERRIDE, value: "0" });
      break;
    }
    case "language-swap":
    case "language-lose": {
      // Sets can't reliably lose one member through ADD, so the effect overrides the whole set.
      // Its priority grows with each death, so a later language glitch includes the earlier one.
      const lose = pick(pools.lose, rng);
      const next = (info.languages ?? []).filter(l => l !== lose);
      v.language = lose;
      if (entry.kind === "language-swap") { v.language2 = pick(pools.gain, rng); next.push(v.language2); }
      plan.changes.push({ key: "system.traits.languages.value", mode: MODES.OVERRIDE, value: JSON.stringify(next) });
      break;
    }
    case "resist-swap": {
      const [vul, res] = sample(pools.free, 2, rng);
      Object.assign(v, { type: vul, type2: res });
      plan.changes.push({ key: "system.traits.dv.value", mode: MODES.ADD, value: vul });
      plan.changes.push({ key: "system.traits.dr.value", mode: MODES.ADD, value: res });
      break;
    }
    case "vulnerability": {
      v.type = pick(pools.free, rng);
      plan.changes.push({ key: "system.traits.dv.value", mode: MODES.ADD, value: v.type });
      break;
    }
    case "init-down": {
      v.n = p.amount ?? 2;
      plan.changes.push({ key: "system.attributes.init.bonus", mode: MODES.ADD, value: String(-v.n) });
      break;
    }
    case "darkvision-lose": {
      v.n = Number(info.darkvision);
      plan.changes.push({ key: "system.attributes.senses.ranges.darkvision", mode: MODES.OVERRIDE, value: "0" });
      break;
    }
    case "hp-down": {
      v.n = Math.max(1, Math.round((p.perLevel ?? 1) * Number(info.level)));
      plan.changes.push({ key: "system.attributes.hp.tempmax", mode: MODES.ADD, value: String(-v.n) });
      break;
    }
    case "lose-item":
    case "forget-spell":
    case "fade-feature": {
      const item = pick(pools.items, rng);
      v[entry.kind === "forget-spell" ? "spell" : entry.kind === "fade-feature" ? "feature" : "item"] = item.name;
      plan.ops.push({ op: "delete-item", itemId: item.id, name: item.name, mode: entry.kind === "lose-item" ? (p.mode ?? "corpse") : "gone" });
      break;
    }
    case "fewer-uses": {
      const item = pick(pools.items, rng);
      v.feature = item.name;
      v.from = Number(item.usesMax);
      v.to = Number(item.usesMax) - 1;
      plan.ops.push({ op: "update-item", itemId: item.id, name: item.name,
        update: { "system.uses.max": `(${item.usesSource}) - 1` }, revert: { "system.uses.max": item.usesSource } });
      break;
    }
    case "unattune": {
      const item = pick(pools.items, rng);
      v.item = item.name;
      plan.ops.push({ op: "update-item", itemId: item.id, name: item.name,
        update: { "system.attuned": false }, revert: { "system.attuned": true } });
      break;
    }
  }
  return plan;
}

/** Fill {placeholders}. Unknown ones are left as they are, so a typo in a pack is visible. */
export function fillText(template, vars = {}) {
  return String(template ?? "").replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

/** Replace ids in vars with readable labels (abilities, skills, languages, damage types). */
export function labelVars(vars, labels = {}) {
  const out = { ...vars };
  const map = { ability: "abilities", ability2: "abilities", skill: "skills", skill2: "skills", language: "languages", language2: "languages", type: "damage", type2: "damage" };
  for (const [k, group] of Object.entries(map)) if (out[k] != null) out[k] = labels[group]?.[out[k]] ?? out[k];
  return out;
}

/* ------------------------------------------------------------------ */
/* Records and the log                                                 */
/* ------------------------------------------------------------------ */

/** Number this death will have on the ladder: previous returns + 1. */
export const nextDeathNo = returned => Math.max(0, Number(returned) || 0) + 1;

export const isOpen = record => OPEN_STATUS.includes(record?.status);

/** Pipe-safe table cell. */
const cell = s => String(s ?? "").replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim() || " ";

/**
 * The Glitch Tracker as Markdown. `L` supplies localized words:
 * { title, intro, cols: {...}, status: {...}, modes: {...}, tier: n => name, none }
 */
export function logMarkdown(records, L) {
  const cols = ["date", "character", "death", "cause", "where", "wheel", "glitch", "return", "found", "fragment"];
  const rows = [...(records ?? [])].filter(r => r.status !== "cancelled").sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const head = `| ${cols.map(c => L.cols[c]).join(" | ")} |\n|${cols.map(() => "---").join("|")}|`;
  const body = rows.map(r => {
    const wheel = r.wheel?.roll ? `d20 ${r.wheel.roll}${r.wheel.rerolled ? "*" : ""}` : "";
    const glitch = r.status === "raised" || r.status === "replaced" ? L.status[r.status]
      : (r.glitches ?? []).map(g => `${g.title}${g.tier ? ` (${L.tier(g.tier)})` : ""}`).join("; ") || L.status[r.status] || "";
    const ret = r.returnMode ? L.modes[r.returnMode] : "";
    return `| ${[String(r.date ?? "").slice(0, 10), r.actorName, r.deathNo ?? "", r.cause, r.sceneName, wheel, glitch, ret, r.foundAt, r.fragment].map(cell).join(" | ")} |`;
  });
  return `# ${L.title}\n\n${L.intro}\n\n${head}\n${body.length ? body.join("\n") : `| ${L.none} |${" |".repeat(cols.length - 1)}`}\n`;
}

/** Counts per actor for the Characters tab: deaths logged, returns, glitches held. */
export function tally(records, actorId) {
  const mine = (records ?? []).filter(r => r.actorId === actorId && r.status !== "cancelled");
  return {
    deaths: mine.length,
    returned: mine.filter(r => r.status === "returned").length,
    raised: mine.filter(r => r.status === "raised").length
  };
}

/** Sort records newest first, open ones on top. */
export function sortRecords(records) {
  return [...(records ?? [])].sort((a, b) => (isOpen(b) - isOpen(a)) || String(b.date).localeCompare(String(a.date)));
}
