// The Glitch Tracker journal page: every death, rebuilt from the records. A Planar Codex note when the
// Codex is installed (so it exports to the vault), otherwise a GM-only Markdown page.
import { MODULE_ID, TRACKER_FOLDER } from "./constants.mjs";
import { t } from "./i18n.mjs";
import { setting, setSetting } from "./settings.mjs";
import { logMarkdown, RETURN_MODES } from "./util.mjs";
import { serial, records, tierName } from "./state.mjs";

const COLS = ["date", "character", "death", "cause", "where", "wheel", "glitch", "return", "found", "fragment"];

export function trackerMarkdown() {
  return logMarkdown(records(), {
    title: setting("trackerName") || t("Tracker.Title"),
    intro: t("Tracker.Intro"),
    cols: Object.fromEntries(COLS.map(c => [c, t(`Tracker.Col.${c}`)])),
    status: { raised: t("Status.raised"), replaced: t("Status.replaced"), dead: t("Status.dead"), asking: t("Status.asking"), rolled: t("Status.rolled"), accepted: t("Status.accepted"), returned: t("Status.returned") },
    modes: Object.fromEntries(RETURN_MODES.map(m => [m, t(`Return.${m}`)])),
    tier: n => tierName(n),
    none: t("Tracker.None")
  });
}

function toHTML(markdown) {
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n/, "");
  const conv = globalThis.showdown ? new globalThis.showdown.Converter({ tables: true, strikethrough: true }) : null;
  return conv ? conv.makeHtml(body) : `<pre>${foundry.utils.escapeHTML?.(body) ?? body}</pre>`;
}

/** The page, if it still exists. */
export async function trackerPage() {
  const uuid = setting("trackerPage");
  return uuid ? fromUuid(uuid).catch(() => null) : null;
}

/** Create or update the page (GM only, inside serial()). */
export async function syncTracker() {
  if (!game.user.isGM) return null;
  const markdown = trackerMarkdown();
  const codex = game.modules.get("planar-codex");
  const api = codex?.active ? codex.api : null;
  const html = api?.convert ? api.convert(markdown, { gm: true }).html : toHTML(markdown);
  let page = await trackerPage();
  if (page) {
    await page.update({ "text.markdown": markdown, "text.content": html });
    return page;
  }
  const name = setting("trackerName") || t("Tracker.Title");
  if (api?.createCodexNote) {
    page = await api.createCodexNote({ name, markdown });
  } else {
    let folder = game.folders.find(f => f.type === "JournalEntry" && f.name === TRACKER_FOLDER);
    folder ??= await Folder.create({ name: TRACKER_FOLDER, type: "JournalEntry" });
    const entry = await JournalEntry.create({
      name, folder: folder.id,
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
      pages: [{ name, type: "text", text: { format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.MARKDOWN, markdown, content: html } }]
    });
    page = entry.pages.contents[0];
  }
  if (page?.uuid) await setSetting("trackerPage", page.uuid);
  return page;
}

let timer = null;
/** Rebuild the page 1.5 s after the last change. */
export function scheduleTrackerSync() {
  if (!game.user.isGM || !game.users.activeGM?.isSelf) return;
  clearTimeout(timer);
  timer = setTimeout(() => serial(syncTracker).catch(err => console.warn(`${MODULE_ID} | tracker page`, err)), 1500);
}
