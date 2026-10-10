const PREFIX = "PLANAR_GLITCH.";

/** Localize a key under PLANAR_GLITCH.*, optionally with {placeholders}. */
export function t(key, data) {
  return data ? game.i18n.format(PREFIX + key, data) : game.i18n.localize(PREFIX + key);
}

export const warn = (key, data) => ui.notifications.warn(t(key, data));
export const info = (key, data) => ui.notifications.info(t(key, data));
