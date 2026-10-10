// The tag on the sheet: a ⟲ badge on every item, feature or effect born of a death or changed by one,
// a ◈ on the nexus, and a small death counter in the sheet's header. Plus "Mark as nexus" on items.
import { MODULE_ID } from "./constants.mjs";
import { t } from "./i18n.mjs";
import { escapeHTML as esc } from "./util.mjs";
import { nexusIds, glitchItems, returnedDeaths } from "./actor.mjs";
import { tierName } from "./state.mjs";

function badge(kind, tooltip) {
  const el = document.createElement("span");
  el.className = `pg-badge pg-badge-${kind}`;
  el.textContent = kind === "nexus" ? "◈" : "⟲";
  el.dataset.tooltip = tooltip;
  el.setAttribute("aria-label", tooltip);
  return el;
}

const tipFor = data => t("Sheet.Badge", { n: data?.deathNo ?? "?", date: String(data?.date ?? "").slice(0, 10) });

/** Rows that carry an id, skipping nested elements of the same row. */
function rows(root, attr) {
  return [...root.querySelectorAll(`[${attr}]`)].filter(el => !el.parentElement?.closest(`[${attr}="${CSS.escape(el.getAttribute(attr))}"]`));
}

function nameSlot(row) {
  return row.querySelector(".item-name .title, .item-name h4, .name .title, .name-stacked .title, .item-name, .name, h4") ?? row;
}

export function decorateSheet(app, element) {
  const actor = app?.document ?? app?.actor;
  if (actor?.documentName !== "Actor") return;
  const root = element instanceof HTMLElement ? element : element?.[0] ?? app.element;
  if (!root?.querySelectorAll) return;
  const nexus = nexusIds(actor);

  for (const row of rows(root, "data-item-id")) {
    if (row.querySelector(":scope .pg-badge")) continue;
    const item = actor.items.get(row.dataset.itemId);
    if (!item) continue;
    const g = item.getFlag(MODULE_ID, "glitch");
    const touched = item.getFlag(MODULE_ID, "touched");
    const slot = nameSlot(row);
    if (g) slot.append(badge(g.kept ? "kept" : "glitch", `${tierName(g.tier)} · ${tipFor(g)}${g.kept ? ` · ${t("Sheet.Kept")}` : ""}`));
    else if (touched) slot.append(badge("touched", `${touched.born ? t("Sheet.Born") : t("Sheet.Changed", { title: touched.title ?? "" })} · ${tipFor(touched)}`));
    if (nexus.includes(item.id)) slot.append(badge("nexus", t("Sheet.Nexus")));
  }

  for (const row of rows(root, "data-effect-id")) {
    if (row.querySelector(":scope .pg-badge")) continue;
    const id = row.dataset.effectId;
    const effect = actor.effects.get(id) ?? [...(actor.allApplicableEffects?.() ?? [])].find(e => e.id === id);
    if (effect?.getFlag?.(MODULE_ID, "glitch")) nameSlot(row).append(badge("glitch", t("Sheet.Effect")));
  }

  const deaths = returnedDeaths(actor);
  if (!deaths || root.querySelector(".pg-counter")) return;
  const glitches = glitchItems(actor).length;
  const counter = document.createElement("span");
  counter.className = "pg-counter";
  counter.innerHTML = `⟲ ${esc(deaths)}`;
  counter.dataset.tooltip = t("Sheet.Counter", { deaths, glitches });
  const target = root.querySelector(".sheet-header .document-name, .sheet-header .name-stacked, .sheet-header h1, .window-header .window-title");
  target?.after ? target.after(counter) : root.prepend(counter);
}

/** Item context menu (dnd5e): mark or unmark the nexus. GM only. */
export function nexusMenu(item, options) {
  if (!game.user.isGM || !item?.actor || item.getFlag(MODULE_ID, "glitch")) return;
  const on = nexusIds(item.actor).includes(item.id);
  const label = on ? "PLANAR_GLITCH.Sheet.UnmarkNexus" : "PLANAR_GLITCH.Sheet.MarkNexus";
  options.push({
    name: label,
    label, // newer ContextMenu entries use label
    icon: '<i class="fa-solid fa-diamond"></i>',
    callback: () => item.actor.setFlag(MODULE_ID, "nexus", on ? [] : [item.id])
  });
}
