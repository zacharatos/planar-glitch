import { MODULE_ID, FEATURE_TYPE } from "./constants.mjs";
import { registerSettings } from "./settings.mjs";
import { loadDefaultCatalog, catalog, records } from "./state.mjs";
import { registerSocket, onPrompt, setFxPlayer } from "./rpc.mjs";
import { registerDetection, recordDeath } from "./deaths.mjs";
import { mend } from "./apply.mjs";
import { glitchItems } from "./actor.mjs";
import { GlitchConsole } from "./console.mjs";
import { WheelWindow } from "./wheel.mjs";
import { decorateSheet, nexusMenu } from "./sheet.mjs";
import { playGlitch } from "./fx.mjs";
import { serial } from "./state.mjs";

const refresh = () => GlitchConsole.instance?.refreshSoon();

Hooks.once("init", () => {
  registerSettings({ onState: refresh });
  // Glitch features get their own feature type (and their own group on the sheet).
  try {
    const types = globalThis.CONFIG?.DND5E?.featureTypes;
    if (types && !types[FEATURE_TYPE]) types[FEATURE_TYPE] = { label: "PLANAR_GLITCH.FeatureType" };
  } catch (err) { console.warn(`${MODULE_ID} | feature type`, err); }
  game.keybindings.register(MODULE_ID, "open", {
    name: "PLANAR_GLITCH.Keybinding.Open",
    editable: [],
    restricted: true,
    onDown: () => { GlitchConsole.open(); return true; }
  });
});

Hooks.once("ready", async () => {
  await loadDefaultCatalog();
  registerSocket();
  setFxPlayer(playGlitch);
  onPrompt("wheel", payload => WheelWindow.ask(payload));
  registerDetection();
  const module = game.modules.get(MODULE_ID);
  if (module) module.api = {
    open: () => GlitchConsole.open(),
    recordDeath: (actor, opts) => recordDeath(typeof actor === "string" ? game.actors.get(actor) : actor, opts),
    glitches: actor => glitchItems(typeof actor === "string" ? game.actors.get(actor) : actor),
    mend: (actor, itemId) => {
      const a = typeof actor === "string" ? game.actors.get(actor) : actor;
      const item = a?.items.get(itemId);
      return item ? serial(() => mend(a, item)) : null;
    },
    endGlitch: () => GlitchConsole.open({ tab: "characters" }),
    records: () => records(),
    catalog: () => catalog(),
    playFx: data => playGlitch(data)
  };
});

// Open the console on a death (GM).
Hooks.on(`${MODULE_ID}.death`, rec => {
  if (game.user.isGM && game.settings.get(MODULE_ID, "autoOpen")) GlitchConsole.open({ recordId: rec.id });
  else refresh();
});
Hooks.on(`${MODULE_ID}.changed`, refresh);

// Toolbar button for the GM.
Hooks.on("getSceneControlButtons", controls => {
  if (!game.user?.isGM || !controls?.tokens?.tools) return;
  controls.tokens.tools[MODULE_ID] = {
    name: MODULE_ID,
    title: "PLANAR_GLITCH.ToolTitle",
    icon: "fa-solid fa-arrows-spin",
    order: 61,
    button: true,
    visible: true,
    onChange: () => GlitchConsole.open()
  };
});

// Keep the console current when glitch features or the actors change.
for (const hook of ["createItem", "updateItem", "deleteItem"]) Hooks.on(hook, item => { if (item?.getFlag?.(MODULE_ID, "glitch") || item?.getFlag?.(MODULE_ID, "touched")) refresh(); });
Hooks.on("updateActor", refresh);
Hooks.on("updateUser", refresh);
Hooks.on("userConnected", refresh);

// The tag on the sheet.
Hooks.on("renderActorSheetV2", decorateSheet);
Hooks.on("renderActorSheet", decorateSheet);
Hooks.on("dnd5e.getItemContextOptions", nexusMenu);
