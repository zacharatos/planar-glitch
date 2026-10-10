import { MODULE_ID } from "./constants.mjs";

const hidden = (key, type, def, onChange) => game.settings.register(MODULE_ID, key, {
  scope: "world", config: false, type, default: def, onChange
});
const world = (key, type, def, extra = {}) => game.settings.register(MODULE_ID, key, {
  name: `PLANAR_GLITCH.Settings.${key}.Name`, hint: `PLANAR_GLITCH.Settings.${key}.Hint`,
  scope: "world", config: true, type, default: def, ...extra
});

/**
 * World data lives in hidden world settings (every client can read them; only the active GM writes).
 * onChange lets every client redraw when the GM changes something.
 */
export function registerSettings({ onState } = {}) {
  hidden("records", Object, { schema: 1, list: [] }, () => onState?.("records"));
  hidden("pack", Object, null, () => onState?.("pack"));
  hidden("trackerPage", String, "");

  world("detectSaves", Boolean, true);
  world("detectDead", Boolean, true);
  world("autoOpen", Boolean, true);
  world("askPlayer", Boolean, true);
  world("wheel", Boolean, true);
  world("defaultReturn", String, "spent", { choices: {
    spent: "PLANAR_GLITCH.Return.spent", rested: "PLANAR_GLITCH.Return.rested", wait: "PLANAR_GLITCH.Return.wait"
  } });
  world("corpse", Boolean, true);
  world("textLanguage", String, "auto", { choices: {
    auto: "PLANAR_GLITCH.Settings.textLanguage.Auto", en: "English", el: "Ελληνικά"
  } });
  world("trackerName", String, "Glitch Tracker");
  world("padDeath", String, "");
  world("padReturn", String, "");
  game.settings.register(MODULE_ID, "fx", {
    name: "PLANAR_GLITCH.Settings.fx.Name", hint: "PLANAR_GLITCH.Settings.fx.Hint",
    scope: "client", config: true, type: Boolean, default: true
  });
}

export const setting = key => game.settings.get(MODULE_ID, key);
export const setSetting = (key, value) => game.settings.set(MODULE_ID, key, value);
