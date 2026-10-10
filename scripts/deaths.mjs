// The death record, start to finish (GM side): record a death and leave the body, hold for combat,
// the Wheel and the candidates, accept, bring the character back, place the token, or the exits
// (raised, another character, cancel). Every write runs on the active GM's client inside serial().
import { MODULE_ID, CORPSE_TINT, WHEEL_TIMEOUT_MS } from "./constants.mjs";
import { t, info, warn } from "./i18n.mjs";
import { setting } from "./settings.mjs";
import {
  tierForDeath, wheelTier, pickCandidates, resolve, fillText, labelVars, nextDeathNo, isPersonal,
  escapeHTML as esc, MODES
} from "./util.mjs";
import { serial, catalog, entry, record, records, openRecordFor, updateRecord, addRecord, local, textLang, tierName } from "./state.mjs";
import { actorInfo, languagePool, labels, ownerUser, returnedDeaths, tokensOf } from "./actor.mjs";
import { applyGlitch } from "./apply.mjs";
import { ask, handle, broadcastFx } from "./rpc.mjs";
import { scheduleTrackerSync } from "./tracker.mjs";
import { rollWheel } from "./wheel.mjs";

const DEFEATED = () => CONFIG.specialStatusEffects?.DEFEATED ?? "dead";
const isActiveGM = () => !!game.users.activeGM?.isSelf;
export const isPC = actor => actor?.type === "character" && actor.hasPlayerOwner;

/** Optional Planar Soundboard pad (names from the settings). */
export function pad(which) {
  const name = setting(`pad${which}`);
  if (!name) return;
  try { globalThis.PlanarSoundboard?.playPad?.(name); }
  catch (err) { console.warn(`${MODULE_ID} | soundboard pad`, err); }
}

const sceneOf = rec => game.scenes.get(rec.sceneId) ?? null;
export const corpseOf = rec => sceneOf(rec)?.tokens.get(rec.corpseTokenId) ?? null;
const hiddenTokenOf = rec => sceneOf(rec)?.tokens.get(rec.tokenId) ?? null;

/** Is the fight this character died in still going? */
export function inCombat(rec) {
  const c = rec?.combatId ? game.combats.get(rec.combatId) : null;
  return !!c;
}

/* ------------------------------------------------------------------ */
/* Death                                                               */
/* ------------------------------------------------------------------ */

/** Leave a grey, empty, dead copy of the token where the character fell. Returns its id. */
async function leaveBody(token, rec) {
  const data = token.toObject();
  delete data._id;
  delete data.delta;
  Object.assign(data, {
    actorLink: false,
    name: t("Corpse.Name", { name: token.name }),
    hidden: false,
    displayBars: CONST.TOKEN_DISPLAY_MODES?.NONE ?? 0,
    light: { dim: 0, bright: 0 },
    sight: { enabled: false }
  });
  data.texture = { ...(data.texture ?? {}), tint: CORPSE_TINT };
  foundry.utils.setProperty(data, `flags.${MODULE_ID}.corpse`, { recordId: rec.id, actorId: rec.actorId });
  const [corpse] = await token.parent.createEmbeddedDocuments("Token", [data]);
  try {
    const body = corpse?.actor;
    if (body) {
      const ids = body.items.map(i => i.id);
      if (ids.length) await body.deleteEmbeddedDocuments("Item", ids);
      await body.update({ "system.attributes.hp.value": 0 });
      await body.toggleStatusEffect(DEFEATED(), { active: true, overlay: true });
    }
  } catch (err) { console.warn(`${MODULE_ID} | could not lay out the body`, err); }
  return corpse?.id ?? null;
}

/**
 * Record a death: hide the token, leave the body, note the fight it happened in.
 * Returns the new record, or null if this character already has an open one.
 */
export function recordDeath(actor, { cause = "", source = "manual" } = {}) {
  if (!game.user.isGM) return Promise.resolve(null);
  return serial(async () => {
    if (!actor || openRecordFor(actor.id)) return null;
    const token = tokensOf(actor)[0] ?? null;
    const scene = token?.parent ?? canvas?.scene ?? null;
    const combat = game.combats.find(c => c.started && c.combatants.some(cb => cb.actorId === actor.id));
    const rec = {
      id: foundry.utils.randomID(),
      actorId: actor.id, actorName: actor.name, img: actor.img,
      userId: ownerUser(actor)?.id ?? null,
      sceneId: scene?.id ?? null, sceneName: scene?.name ?? "",
      tokenId: token?.id ?? null, corpseTokenId: null,
      date: new Date().toISOString(), worldTime: game.time?.worldTime ?? 0,
      cause, source,
      deathNo: nextDeathNo(returnedDeaths(actor)),
      combatId: combat?.id ?? null,
      status: "dead",
      wheel: null, candidates: [], choice: null, pickedBy: null,
      glitches: [], returnMode: setting("defaultReturn") || "spent", restReady: false,
      foundAt: "", fragment: "", placed: false
    };
    if (token && setting("corpse")) rec.corpseTokenId = await leaveBody(token, rec);
    if (token) await token.update({ hidden: true });
    const combatant = combat?.combatants.find(cb => cb.actorId === actor.id);
    if (combatant && !combatant.defeated) await combatant.update({ defeated: true }).catch(() => {});
    await addRecord(rec);
    return rec;
  }).then(rec => {
    if (rec) {
      pad("Death");
      scheduleTrackerSync();
      Hooks.callAll(`${MODULE_ID}.death`, rec);
    }
    return rec;
  });
}

/* ------------------------------------------------------------------ */
/* The Wheel and the candidates                                        */
/* ------------------------------------------------------------------ */

/** Short lines saying what a plan does to the sheet (for the GM's preview). */
export function effectLines(plan, L = labels()) {
  const lines = [];
  for (const c of plan.changes ?? []) {
    const k = c.key;
    let m;
    if ((m = k.match(/^system\.abilities\.(\w+)\.value$/))) lines.push(`${L.abilities[m[1]] ?? m[1]} ${Number(c.value) > 0 ? "+" : ""}${c.value}`);
    else if ((m = k.match(/^system\.skills\.(\w+)\.value$/))) lines.push(t(c.value === "0" ? "Effect.SkillLost" : "Effect.SkillGained", { skill: L.skills[m[1]] ?? m[1] }));
    else if (k === "system.traits.languages.value") lines.push(t("Effect.Languages", { list: JSON.parse(c.value).map(l => L.languages[l] ?? l).join(", ") }));
    else if (k === "system.traits.dv.value") lines.push(t("Effect.Vulnerable", { type: L.damage[c.value] ?? c.value }));
    else if (k === "system.traits.dr.value") lines.push(t("Effect.Resistant", { type: L.damage[c.value] ?? c.value }));
    else if (k === "system.attributes.init.bonus") lines.push(t("Effect.Initiative", { n: c.value }));
    else if (k.includes("darkvision")) lines.push(t("Effect.Darkvision"));
    else if (k === "system.attributes.hp.tempmax") lines.push(t("Effect.HitPoints", { n: c.value }));
    else lines.push(`${k} ${c.mode === MODES.ADD ? "+" : "="} ${c.value}`);
  }
  for (const op of plan.ops ?? []) {
    if (op.op === "delete-item") lines.push(t(op.mode === "corpse" ? "Effect.ItemOnBody" : "Effect.ItemGone", { name: op.name }));
    else if (op.revert?.["system.attuned"]) lines.push(t("Effect.Unattuned", { name: op.name }));
    else lines.push(t("Effect.FewerUses", { name: op.name }));
  }
  return lines.length ? lines : [t("Effect.None")];
}

function candidateFrom(e, plan, L) {
  const lang = textLang();
  return {
    entryId: e.id, tier: plan.tier, plan,
    title: local(e.title),
    text: fillText(local(e.text), labelVars(plan.vars, L)),
    personal: isPersonal(e),
    lines: effectLines(plan, L),
    lang
  };
}

/** Roll candidates for a record at the tier the Wheel gives (inside serial()). */
async function computeCandidates(recordId, { roll = null, rerolled = false, exclude = [], keepWheel = false } = {}) {
  return updateRecord(recordId, async r => {
    const actor = game.actors.get(r.actorId);
    if (!actor) throw new Error(t("Notify.NoActor"));
    const base = tierForDeath(r.deathNo);
    const w = keepWheel && r.wheel ? r.wheel : { roll, rerolled, base, ...wheelTier(base, roll) };
    const info = actorInfo(actor);
    const pool = languagePool();
    const L = labels();
    const out = [];
    for (const c of pickCandidates(catalog(), w.tier, info, { count: 2, languagePool: pool, exclude })) {
      const plan = resolve(c.entry, info, { languagePool: pool, deathNo: r.deathNo });
      if (!plan) continue;
      plan.tier = c.tier;
      out.push(candidateFrom(c.entry, plan, L));
    }
    if (!out.length) throw new Error(t("Notify.NoCandidates"));
    r.wheel = w;
    r.candidates = out;
    r.choice = w.count === 2 ? "both" : null;
  });
}

/** What the player's dialog shows. */
const candidateView = r => ({
  recordId: r.id,
  wheel: r.wheel,
  tierName: tierName(r.wheel?.tier ?? 1),
  both: r.choice === "both",
  candidates: r.candidates.map(c => ({ title: c.title, text: c.text, personal: c.personal, tierName: tierName(c.tier) }))
});

// Player -> GM: "here is my roll, give me my two probable selves".
handle("candidates", ({ recordId, roll, rerolled }, user) => serial(async () => {
  const rec = record(recordId);
  const actor = game.actors.get(rec?.actorId);
  if (!rec || rec.status !== "asking") throw new Error(t("Notify.NotAsking"));
  if (!user?.isGM && !actor?.testUserPermission(user, "OWNER")) throw new Error(t("Notify.NotYours"));
  const r = await computeCandidates(recordId, { roll: setting("wheel") ? Number(roll) || null : null, rerolled: !!rerolled });
  return candidateView(r);
}));

/**
 * Turn the Wheel. With a player online (and the setting on) the dialog opens on their screen and
 * they pick; otherwise the GM rolls here and picks in the console.
 */
export async function startWheel(recordId, { byGM = false } = {}) {
  const rec = record(recordId);
  if (!rec) return;
  const actor = game.actors.get(rec.actorId);
  if (!actor) return warn("Notify.NoActor");
  const user = game.users.get(rec.userId);
  if (!byGM && setting("askPlayer") && user?.active) {
    await serial(() => updateRecord(recordId, r => { r.status = "asking"; r.wheel = null; r.candidates = []; r.choice = null; r.pickedBy = null; }));
    info("Notify.Asking", { name: user.name });
    const payload = {
      recordId, actorId: actor.id, actorName: actor.name, img: actor.img, deathNo: rec.deathNo,
      tier: tierForDeath(rec.deathNo), tierName: tierName(tierForDeath(rec.deathNo)),
      wheel: !!setting("wheel")
    };
    const answer = await ask(user.id, "wheel", payload, null, WHEEL_TIMEOUT_MS);
    let gave = false;
    await serial(() => updateRecord(recordId, r => {
      if (r.status !== "asking") return; // the GM took over meanwhile
      if (!answer || !r.candidates.length || (r.choice !== "both" && !Number.isInteger(answer.choice))) { r.status = "dead"; return; }
      if (r.choice !== "both") r.choice = Math.min(Math.max(0, answer.choice), r.candidates.length - 1);
      r.pickedBy = "player";
      r.status = "rolled";
      gave = true;
    }));
    if (!gave && record(recordId)?.status === "dead") warn("Notify.NoAnswer", { name: user.name });
    return;
  }
  const roll = setting("wheel") ? await rollWheel(actor) : null;
  await serial(async () => {
    await computeCandidates(recordId, { roll });
    await updateRecord(recordId, r => { r.status = "rolled"; r.pickedBy = "gm"; });
  });
}

/** The GM stops waiting for the player and picks in the console. */
export const takeOver = recordId => serial(() => updateRecord(recordId, r => { if (r.status === "asking") r.status = r.candidates.length ? "rolled" : "dead"; }));

/** GM: two new candidates at the same tier (the Wheel's roll stays). */
export const rerollCandidates = recordId => serial(async () => {
  const exclude = (record(recordId)?.candidates ?? []).map(c => c.entryId);
  try { await computeCandidates(recordId, { keepWheel: true, exclude }); }
  catch { await computeCandidates(recordId, { keepWheel: true }); }
});

/** GM: put a specific catalog entry in slot `index` (resolved against the actor now). */
export const chooseEntry = (recordId, index, entryId) => serial(() => updateRecord(recordId, r => {
  const e = entry(entryId);
  const actor = game.actors.get(r.actorId);
  if (!e || !actor) throw new Error(t("Notify.NoActor"));
  const plan = resolve(e, actorInfo(actor), { languagePool: languagePool(), deathNo: r.deathNo });
  if (!plan) throw new Error(t("Notify.DoesNotFit"));
  const c = candidateFrom(e, plan, labels());
  if (r.choice === "both") r.candidates[index] = c;
  else { r.candidates[index ?? 0] = c; r.choice = index ?? 0; }
  r.pickedBy = "gm";
}));

export const setChoice = (recordId, index) => serial(() => updateRecord(recordId, r => {
  if (r.choice !== "both") r.choice = index;
}));
export const setText = (recordId, index, text) => serial(() => updateRecord(recordId, r => { if (r.candidates[index]) r.candidates[index].text = text; }));
export const setField = (recordId, field, value) => serial(() => updateRecord(recordId, r => {
  if (["cause", "foundAt", "fragment", "returnMode"].includes(field)) r[field] = value;
})).then(() => scheduleTrackerSync());

export const accept = recordId => serial(() => updateRecord(recordId, r => {
  if (r.choice == null) throw new Error(t("Notify.PickFirst"));
  r.status = "accepted";
}));
export const unaccept = recordId => serial(() => updateRecord(recordId, r => { if (r.status === "accepted") r.status = "rolled"; }));

/* ------------------------------------------------------------------ */
/* Coming back                                                         */
/* ------------------------------------------------------------------ */

async function restoreLife(actor, mode) {
  if (mode === "rested" || mode === "wait") {
    try { await actor.longRest?.({ dialog: false, chat: false, newDay: false }); }
    catch (err) { console.warn(`${MODULE_ID} | long rest`, err); }
  }
  for (const s of [DEFEATED(), "unconscious", "prone", "stable"]) {
    if (actor.statuses?.has(s)) await actor.toggleStatusEffect(s, { active: false }).catch(() => {});
  }
  const hp = actor.system.attributes?.hp ?? {};
  const max = Number(hp.effectiveMax ?? ((Number(hp.max) || 0) + (Number(hp.tempmax) || 0))) || Number(hp.max) || 1;
  await actor.update({
    "system.attributes.hp.value": Math.max(1, max),
    "system.attributes.death.success": 0,
    "system.attributes.death.failure": 0
  });
}

/** Apply the chosen glitch(es) and bring the character back to life. Placing the token is separate. */
export async function returnCharacter(recordId, { mode } = {}) {
  const result = await serial(async () => {
    const rec = record(recordId);
    if (!rec || rec.status !== "accepted") throw new Error(t("Notify.PickFirst"));
    const actor = game.actors.get(rec.actorId);
    if (!actor) throw new Error(t("Notify.NoActor"));
    const chosen = rec.choice === "both" ? rec.candidates : [rec.candidates[rec.choice]].filter(Boolean);
    const corpse = corpseOf(rec);
    const applied = [];
    for (const c of chosen) applied.push(await applyGlitch(actor, { candidate: c, record: rec, corpse, tierLabel: tierName(c.tier) }));
    const m = mode ?? rec.returnMode ?? "spent";
    await restoreLife(actor, m);
    await actor.setFlag(MODULE_ID, "deaths", Math.max(returnedDeaths(actor), rec.deathNo));
    return updateRecord(recordId, r => {
      r.status = "returned"; r.glitches = applied; r.returnMode = m; r.returnedAt = new Date().toISOString();
    });
  });
  scheduleTrackerSync();
  Hooks.callAll(`${MODULE_ID}.return`, result);
  return result;
}

/** Wait for one click on the canvas (Esc cancels). Resolves {x, y} in scene coordinates, or null. */
export function pickPoint() {
  return new Promise(resolvePoint => {
    const view = canvas?.app?.view ?? canvas?.app?.canvas;
    if (!view || !canvas.scene) { warn("Notify.NoScene"); return resolvePoint(null); }
    info("Notify.ClickToPlace");
    const done = v => {
      view.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      view.style.cursor = "";
      resolvePoint(v);
    };
    const onDown = ev => {
      if (ev.button !== 0) return;
      ev.preventDefault(); ev.stopPropagation();
      let p = canvas.canvasCoordinatesFromClient?.({ x: ev.clientX, y: ev.clientY });
      if (!p) {
        const rect = view.getBoundingClientRect();
        p = canvas.stage.worldTransform.applyInverse({ x: ev.clientX - rect.left, y: ev.clientY - rect.top });
      }
      done({ x: p.x, y: p.y });
    };
    const onKey = ev => { if (ev.key === "Escape") done(null); };
    view.style.cursor = "crosshair";
    view.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
  });
}

function topLeftFor(point, widthInGrid = 1, heightInGrid = 1) {
  const size = canvas.grid?.size ?? canvas.dimensions?.size ?? 100;
  const raw = { x: point.x - (widthInGrid * size) / 2, y: point.y - (heightInGrid * size) / 2 };
  try {
    const mode = CONST.GRID_SNAPPING_MODES?.TOP_LEFT_VERTEX;
    if (mode !== undefined && canvas.grid?.getSnappedPoint) return canvas.grid.getSnappedPoint(raw, { mode });
  } catch { /* fall through */ }
  return { x: Math.round(raw.x / size) * size, y: Math.round(raw.y / size) * size };
}

/** Put the actor's token where the GM clicks (on the scene he is viewing). */
async function placeActor(actor, point, rec) {
  const scene = canvas.scene;
  const tok = scene.tokens.find(t => t.actorId === actor.id && t.actorLink);
  const proto = actor.prototypeToken;
  const pos = topLeftFor(point, tok?.width ?? proto?.width ?? 1, tok?.height ?? proto?.height ?? 1);
  if (tok) await tok.update({ x: pos.x, y: pos.y, hidden: false }, { animate: false });
  else {
    const td = await actor.getTokenDocument({ x: pos.x, y: pos.y, hidden: false });
    await scene.createEmbeddedDocuments("Token", [td.toObject()]);
    // The hidden token on the scene where they died isn't needed any more.
    if (rec?.actorId === actor.id && rec.sceneId !== scene.id) await hiddenTokenOf(rec)?.delete().catch(() => {});
  }
}

/** Glitch screen everywhere, a whisper to the player with the glitch text, the Return pad. */
async function announce(rec) {
  const actor = game.actors.get(rec.actorId);
  broadcastFx({ name: rec.actorName, glitches: (rec.glitches ?? []).map(g => g.title) });
  pad("Return");
  const items = (rec.glitches ?? []).map(g => actor?.items.get(g.itemId)).filter(Boolean);
  const body = items.map(i => `<h4>${esc(i.name)}</h4>${i.system.description?.value ?? ""}`).join("");
  const whisper = [rec.userId, ...game.users.filter(u => u.isGM).map(u => u.id)].filter(Boolean);
  await ChatMessage.create({
    content: `<div class="planar-glitch-card"><header><i class="fa-solid fa-arrows-spin"></i> ${esc(t("Card.Title", { name: rec.actorName }))}</header>${body}</div>`,
    speaker: { alias: t("Card.Speaker") },
    whisper
  });
}

/** Click the spot where they turn up. Returns true when placed. */
export async function place(recordId) {
  const rec = record(recordId);
  if (!rec) return false;
  const actorId = rec.status === "replaced" ? rec.replacementId : rec.actorId;
  const actor = game.actors.get(actorId);
  if (!actor) return warn("Notify.NoActor");
  const point = await pickPoint();
  if (!point) return false;
  await serial(async () => {
    await placeActor(actor, point, rec);
    await updateRecord(recordId, r => { r.placed = true; r.placedScene = canvas.scene?.name ?? ""; });
  });
  if (rec.status === "returned") await announce(record(recordId));
  return true;
}

/** Returned, but the GM moves the token himself. */
export async function markPlaced(recordId) {
  const rec = record(recordId);
  await serial(async () => {
    await hiddenTokenOf(rec)?.update({ hidden: false }).catch(() => {});
    await updateRecord(recordId, r => { r.placed = true; });
  });
  if (rec?.status === "returned") await announce(record(recordId));
}

/* ------------------------------------------------------------------ */
/* Other ways out                                                      */
/* ------------------------------------------------------------------ */

async function undoDeath(rec, actor, { raised }) {
  const corpse = corpseOf(rec);
  const tok = hiddenTokenOf(rec);
  if (tok) await tok.update({ hidden: false, ...(corpse ? { x: corpse.x, y: corpse.y } : {}) }, { animate: false }).catch(() => {});
  if (corpse) await corpse.delete().catch(() => {});
  if (!actor) return;
  if (actor.statuses?.has(DEFEATED())) await actor.toggleStatusEffect(DEFEATED(), { active: false }).catch(() => {});
  const update = { "system.attributes.death.success": 0, "system.attributes.death.failure": 0 };
  if (raised && !(Number(actor.system.attributes?.hp?.value) > 0)) update["system.attributes.hp.value"] = 1;
  await actor.update(update);
  const combatant = game.combats.get(rec.combatId)?.combatants.find(cb => cb.actorId === actor.id);
  if (combatant?.defeated) await combatant.update({ defeated: false }).catch(() => {});
}

/** Brought back by magic before the glitch took them: no glitch (the death stays in the log). */
export async function raised(recordId) {
  await serial(async () => {
    const rec = record(recordId);
    await undoDeath(rec, game.actors.get(rec.actorId), { raised: true });
    await updateRecord(recordId, r => { r.status = "raised"; r.candidates = []; r.choice = null; });
  });
  scheduleTrackerSync();
}

/** A mistake: undo everything and drop the record from the log. */
export async function cancelDeath(recordId) {
  await serial(async () => {
    const rec = record(recordId);
    await undoDeath(rec, game.actors.get(rec.actorId), { raised: false });
    await updateRecord(recordId, r => { r.status = "cancelled"; });
  });
  scheduleTrackerSync();
}

/** The player takes another character from here on (book: New Characters). Then place its token. */
export async function replaceCharacter(recordId, newActorId) {
  const other = game.actors.get(newActorId);
  if (!other) return warn("Notify.NoActor");
  await serial(async () => {
    const rec = record(recordId);
    const user = game.users.get(rec.userId);
    if (user) {
      await other.update({ [`ownership.${user.id}`]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER });
      await user.update({ character: other.id });
    }
    await updateRecord(recordId, r => { r.status = "replaced"; r.replacementId = other.id; r.replacement = other.name; r.candidates = []; r.choice = null; });
  });
  scheduleTrackerSync();
  return place(recordId);
}

/* ------------------------------------------------------------------ */
/* Hooks: detection, combat end, long rest                             */
/* ------------------------------------------------------------------ */

export function registerDetection() {
  Hooks.on("updateActor", (actor, changes) => {
    if (!isActiveGM() || !setting("detectSaves") || !isPC(actor) || actor.isToken) return;
    const f = foundry.utils.getProperty(changes, "system.attributes.death.failure");
    if (f === undefined || Number(f) < 3) return;
    recordDeath(actor, { source: "saves" });
  });
  Hooks.on("createActiveEffect", effect => {
    if (!isActiveGM() || !setting("detectDead")) return;
    const actor = effect.parent;
    if (actor?.documentName !== "Actor" || actor.isToken || !isPC(actor)) return;
    if (!effect.statuses?.has?.(DEFEATED())) return;
    recordDeath(actor, { source: "status" });
  });
  Hooks.on("deleteCombat", combat => {
    if (!isActiveGM()) return;
    const waiting = records().filter(r => r.combatId === combat.id && ["dead", "asking", "rolled", "accepted"].includes(r.status));
    if (waiting.length) info("Notify.CombatOver", { names: waiting.map(r => r.actorName).join(", ") });
    Hooks.callAll(`${MODULE_ID}.changed`);
  });
  Hooks.on("dnd5e.restCompleted", (actor, result, config) => {
    if (!isActiveGM() || actor?.type !== "character") return;
    const long = result?.longRest ?? (config?.type === "long");
    if (!long) return;
    const waiting = records().filter(r => r.returnMode === "wait" && ["dead", "asking", "rolled", "accepted"].includes(r.status) && !r.restReady && r.actorId !== actor.id);
    if (!waiting.length) return;
    serial(async () => { for (const r of waiting) await updateRecord(r.id, x => { x.restReady = true; }); })
      .then(() => info("Notify.Rested", { names: waiting.map(r => r.actorName).join(", ") }));
  });
}
