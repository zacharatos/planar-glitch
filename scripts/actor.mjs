// Reading actors through dnd5e's data model, for the pure rules in util.mjs.
import { MODULE_ID } from "./constants.mjs";
import { ABILITIES } from "./util.mjs";

const NOT_MAGIC = new Set(["", "none", "mundane"]);

/** Ids of the items marked as this actor's nexus (never touched by a glitch). */
export const nexusIds = actor => actor?.getFlag(MODULE_ID, "nexus") ?? [];

/** Glitch features on an actor (items carrying flags.planar-glitch.glitch). */
export const glitchItems = actor => actor?.items.filter(i => i.getFlag(MODULE_ID, "glitch")) ?? [];

/** Deaths this actor came back from (the ladder counts these). */
export const returnedDeaths = actor => Number(actor?.getFlag(MODULE_ID, "deaths")) || 0;

const setOf = v => (v instanceof Set ? [...v] : Array.isArray(v) ? v : []);

/** Plain snapshot of the actor for util.mjs (see the comment above poolsFor there). */
export function actorInfo(actor) {
  const s = actor.system ?? {};
  const nexus = nexusIds(actor);
  const senses = s.attributes?.senses ?? {};
  return {
    name: actor.name,
    level: Number(s.details?.level) || 0,
    abilities: Object.fromEntries(ABILITIES.map(a => [a, Number(s.abilities?.[a]?.value) || 0])),
    skills: Object.fromEntries(Object.entries(s.skills ?? {}).map(([k, v]) => [k, Number(v?.value) || 0])),
    languages: setOf(s.traits?.languages?.value),
    dr: setOf(s.traits?.dr?.value),
    dv: setOf(s.traits?.dv?.value),
    di: setOf(s.traits?.di?.value),
    darkvision: Number(senses.ranges?.darkvision ?? senses.darkvision) || 0,
    glitchIds: glitchItems(actor).map(i => i.getFlag(MODULE_ID, "glitch")?.entryId).filter(Boolean),
    items: actor.items.map(i => {
      const sys = i.system ?? {};
      const props = sys.properties;
      return {
        id: i.id,
        name: i.name,
        type: i.type,
        featType: sys.type?.value ?? "",
        level: Number(sys.level) || 0,
        attuned: !!sys.attuned,
        equipped: !!sys.equipped,
        magic: !!(props?.has?.("mgc") || (Array.isArray(props) && props.includes("mgc")) || !NOT_MAGIC.has(String(sys.rarity ?? ""))),
        quantity: Number(sys.quantity ?? 1),
        usesMax: Number(sys.uses?.max) || 0,
        usesSource: i._source?.system?.uses?.max ?? "",
        nexus: nexus.includes(i.id),
        glitch: !!(i.getFlag(MODULE_ID, "glitch") || i.getFlag(MODULE_ID, "touched")),
        unarmed: /unarmed/i.test(i.name) || sys.type?.value === "natural" || sys.identifier === "unarmed-strike"
      };
    })
  };
}

/** Flatten CONFIG.DND5E.languages (groups with children) into {key: label}. */
export function languageLabels() {
  const out = {};
  const walk = obj => {
    for (const [k, v] of Object.entries(obj ?? {})) {
      if (v && typeof v === "object" && v.children) walk(v.children);
      else out[k] = game.i18n.localize(typeof v === "string" ? v : v?.label ?? k);
    }
  };
  walk(CONFIG.DND5E?.languages);
  return out;
}

/** Languages a glitch may teach: everything spoken, minus secret ones. */
export function languagePool() {
  return Object.keys(languageLabels()).filter(k => !["cant", "druidic"].includes(k));
}

const labelMap = obj => Object.fromEntries(Object.entries(obj ?? {}).map(([k, v]) => [k, game.i18n.localize(typeof v === "string" ? v : v?.label ?? k)]));

/** Readable names for the placeholders. */
export function labels() {
  return {
    abilities: labelMap(CONFIG.DND5E?.abilities),
    skills: labelMap(CONFIG.DND5E?.skills),
    languages: languageLabels(),
    damage: labelMap(CONFIG.DND5E?.damageTypes)
  };
}

/** The player who owns this actor (not a GM), preferring the one who has it as their character. */
export function ownerUser(actor) {
  const players = game.users.filter(u => !u.isGM);
  return players.find(u => u.character?.id === actor.id)
    ?? players.find(u => actor.testUserPermission?.(u, "OWNER"))
    ?? null;
}

/** Player characters: character actors with a player owner. */
export function playerCharacters() {
  return game.actors.filter(a => a.type === "character" && a.hasPlayerOwner);
}

/** Linked tokens of an actor: the one on the viewed scene first, then any other scene. */
export function tokensOf(actor) {
  const here = canvas?.scene?.tokens?.filter(t => t.actorId === actor.id && t.actorLink) ?? [];
  const elsewhere = game.scenes.contents.filter(s => s.id !== canvas?.scene?.id)
    .flatMap(s => s.tokens.filter(t => t.actorId === actor.id && t.actorLink));
  return [...here, ...elsewhere];
}
