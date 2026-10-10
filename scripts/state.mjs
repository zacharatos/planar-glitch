// World data: the catalog (shipped + imported pack) and the death records. Writes happen on the GM's client.
import { MODULE_ID, DEFAULT_CATALOG_PATH } from "./constants.mjs";
import { setting, setSetting } from "./settings.mjs";
import { validateCatalog, mergeCatalogs, localText, RECORD_SCHEMA } from "./util.mjs";

const clone = v => foundry.utils.deepClone(v);
let defaultCatalog = null;

/** One write at a time: a promise queue. Never call serial() from inside a serial() block. */
let queue = Promise.resolve();
export function serial(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

/** Load the generic catalog shipped with the module (once). */
export async function loadDefaultCatalog() {
  if (defaultCatalog) return defaultCatalog;
  try { defaultCatalog = await (await fetch(DEFAULT_CATALOG_PATH)).json(); }
  catch (err) { console.error(`${MODULE_ID} | default catalog failed to load`, err); defaultCatalog = { schema: 1, id: "default", glitches: [] }; }
  return defaultCatalog;
}

export const importedPack = () => setting("pack");
/** The active catalog: the shipped one with the imported pack on top. */
export const catalog = () => mergeCatalogs(defaultCatalog, importedPack());
export const entry = id => catalog().glitches.find(g => g.id === id) ?? null;

/** Import a pack (object). Returns the problems found; saves only if there are none. */
export async function importPack(data) {
  const errors = validateCatalog(data);
  if (errors.length) return errors;
  await setSetting("pack", data);
  return [];
}
export const resetPack = () => setSetting("pack", null);

/** Language for glitch text: the setting, or this client's language. */
export function textLang() {
  const s = setting("textLanguage");
  return s && s !== "auto" ? s : (game.i18n.lang === "el" ? "el" : "en");
}
export const local = value => localText(value, textLang());
export const tierName = tier => local(catalog().tiers.find(x => x.tier === tier)?.name) || String(tier);

/* ---------------- records ---------------- */

export const records = () => setting("records")?.list ?? [];
export const record = id => records().find(r => r.id === id) ?? null;
export const openRecordFor = actorId => records().find(r => r.actorId === actorId && ["dead", "asking", "rolled", "accepted"].includes(r.status)) ?? null;

/** Change one record (inside serial()). fn gets a copy and may mutate it. */
export async function updateRecord(id, fn) {
  const list = clone(records());
  const r = list.find(x => x.id === id);
  if (!r) throw new Error(`No death record ${id}`);
  await fn(r);
  await setSetting("records", { schema: RECORD_SCHEMA, list });
  return r;
}

export async function addRecord(r) {
  const list = [...clone(records()), r];
  await setSetting("records", { schema: RECORD_SCHEMA, list });
  return r;
}
