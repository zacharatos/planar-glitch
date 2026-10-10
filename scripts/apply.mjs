// Turning a resolved plan into documents on the actor, and undoing it.
// Everything needed to undo a glitch is stored on its feature: flags.planar-glitch.glitch.ops.
import { MODULE_ID, TIER_ICON, FEATURE_TYPE } from "./constants.mjs";
import { escapeHTML as esc, MODES } from "./util.mjs";
import { t } from "./i18n.mjs";

const OP = { MOD: MODULE_ID };

/** Description HTML for a glitch feature. */
function describe({ text, tierLabel, deathNo, date }) {
  return `<p>${esc(text)}</p><p class="pg-meta"><em>${esc(t("Item.Meta", { tier: tierLabel, n: deathNo, date: String(date).slice(0, 10) }))}</em></p>`;
}

/**
 * Active Effect changes in the shape this Foundry expects. V14 keeps them in `system.changes` with a
 * string `type` ("add", "override"); older versions in `changes` with a numeric `mode`.
 */
export function effectChanges(changes, priority, generation = game.release?.generation ?? 0) {
  if (generation >= 14) {
    return { system: { changes: changes.map(c => ({ key: c.key, type: c.mode === MODES.OVERRIDE ? "override" : "add", value: c.value, priority })) } };
  }
  return { changes: changes.map(c => ({ key: c.key, mode: c.mode, value: c.value, priority })) };
}

/** Mark an item as changed or born by a glitch (for the ⟲ badge). */
const touch = (item, data) => item.setFlag(MODULE_ID, "touched", data);
const untouch = item => item.unsetFlag(MODULE_ID, "touched");

/**
 * Apply one candidate (with its plan) to the actor. Returns {itemId, title, tier, entryId}.
 * corpse: the corpse TokenDocument (or null), so "left behind" items can wait on the body.
 */
export async function applyGlitch(actor, { candidate, record, corpse = null, tierLabel }) {
  const { plan, title, text } = candidate;
  const date = new Date().toISOString();
  const stamp = { recordId: record.id, deathNo: record.deathNo, date };
  const ops = [];

  for (const op of plan.ops ?? []) {
    const item = actor.items.get(op.itemId);
    if (!item) continue;
    if (op.op === "delete-item") {
      const data = item.toObject();
      await item.delete();
      let corpseItemId = null;
      if (op.mode === "corpse" && corpse?.actor) {
        try {
          const [copy] = await corpse.actor.createEmbeddedDocuments("Item", [data]);
          corpseItemId = copy?.id ?? null;
        } catch (err) { console.warn(`${MODULE_ID} | could not leave the item on the body`, err); }
      }
      ops.push({ op: "restore", mode: op.mode, name: op.name, data, corpseTokenUuid: corpse?.uuid ?? null, corpseItemId, recovered: false });
    } else if (op.op === "update-item") {
      await item.update(op.update);
      await touch(item, { ...stamp, title });
      ops.push({ op: "update", itemId: item.id, name: op.name, revert: op.revert });
    }
  }

  const changes = plan.changes ?? [];
  const img = TIER_ICON(plan.tier);
  const data = {
    name: title,
    type: "feat",
    img,
    system: {
      description: { value: describe({ text, tierLabel, deathNo: record.deathNo, date }) },
      type: { value: FEATURE_TYPE, subtype: "" },
      source: { custom: "Planar Glitch" }
    },
    effects: changes.length ? [{
      name: `⟲ ${title}`,
      img,
      transfer: true,
      disabled: false,
      ...effectChanges(changes, plan.priority),
      description: text,
      flags: { [MODULE_ID]: { glitch: true } }
    }] : [],
    flags: { [MODULE_ID]: { glitch: {
      entryId: plan.entryId, kind: plan.kind, tier: plan.tier, vars: plan.vars,
      recordId: record.id, deathNo: record.deathNo, date, ops, kept: false
    } } }
  };
  const [created] = await actor.createEmbeddedDocuments("Item", [data]);
  return { itemId: created.id, title, tier: plan.tier, entryId: plan.entryId };
}

/** Give the actor an item "born of a death" (the GM dropped it on a record). Undone by Mend/Release. */
export async function giveBorn(actor, itemData, { record, glitchItem }) {
  const data = foundry.utils.deepClone(itemData);
  delete data._id;
  foundry.utils.setProperty(data, `flags.${MODULE_ID}.touched`, { recordId: record.id, deathNo: record.deathNo, date: new Date().toISOString(), born: true });
  const [created] = await actor.createEmbeddedDocuments("Item", [data]);
  if (glitchItem) {
    const g = foundry.utils.deepClone(glitchItem.getFlag(MODULE_ID, "glitch"));
    g.ops.push({ op: "born", itemId: created.id, name: created.name });
    await glitchItem.setFlag(MODULE_ID, "glitch", g);
  }
  return created;
}

async function removeCorpseCopy(op) {
  if (!op.corpseTokenUuid || !op.corpseItemId) return;
  try {
    const token = await fromUuid(op.corpseTokenUuid);
    await token?.actor?.items.get(op.corpseItemId)?.delete();
  } catch (err) { console.warn(`${MODULE_ID} | corpse item`, err); }
}

/** Undo one glitch exactly: restore items, revert updates, remove items it gave, delete the feature. */
export async function mend(actor, glitchItem) {
  const g = glitchItem.getFlag(MODULE_ID, "glitch");
  for (const op of [...(g?.ops ?? [])].reverse()) {
    try {
      if (op.op === "restore" && !op.recovered) {
        if (!actor.items.get(op.data._id)) await actor.createEmbeddedDocuments("Item", [op.data], { keepId: true });
        await removeCorpseCopy(op);
      } else if (op.op === "update") {
        const item = actor.items.get(op.itemId);
        if (item) { await item.update(op.revert); await untouch(item); }
      } else if (op.op === "born") {
        await actor.items.get(op.itemId)?.delete();
      }
    } catch (err) { console.warn(`${MODULE_ID} | mend ${op.op}`, err); }
  }
  await glitchItem.delete();
}

/** Unity of Self: the glitch stays for good. */
export async function keep(glitchItem) {
  const g = foundry.utils.deepClone(glitchItem.getFlag(MODULE_ID, "glitch"));
  g.kept = new Date().toISOString();
  await glitchItem.setFlag(MODULE_ID, "glitch", g);
}

/** Someone went back for the body: the item left behind returns to the actor. */
export async function recover(actor, glitchItem, index) {
  const g = foundry.utils.deepClone(glitchItem.getFlag(MODULE_ID, "glitch"));
  const op = g.ops[index];
  if (!op || op.op !== "restore" || op.recovered) return false;
  if (!actor.items.get(op.data._id)) await actor.createEmbeddedDocuments("Item", [op.data], { keepId: true });
  await removeCorpseCopy(op);
  op.recovered = true;
  await glitchItem.setFlag(MODULE_ID, "glitch", g);
  return true;
}

/** Items waiting on bodies for this actor: [{glitchItem, index, name, mode}]. */
export function waitingItems(actor) {
  const out = [];
  for (const item of actor?.items ?? []) {
    const g = item.getFlag(OP.MOD, "glitch");
    (g?.ops ?? []).forEach((op, index) => {
      if (op.op === "restore" && !op.recovered) out.push({ glitchItem: item, index, name: op.name, mode: op.mode });
    });
  }
  return out;
}
