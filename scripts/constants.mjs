export const MODULE_ID = "planar-glitch";
export const EVENT = `module.${MODULE_ID}`;

/** The generic catalog shipped with the module. */
export const DEFAULT_CATALOG_PATH = `modules/${MODULE_ID}/data/default-catalog.json`;

/** Item icons per tier, shipped in assets/ (drawn for this module). */
export const TIER_ICON = tier => `modules/${MODULE_ID}/assets/glitch-${Math.min(Math.max(1, tier), 5)}.svg`;

/** dnd5e feature type registered for glitch features (their own group on the sheet). */
export const FEATURE_TYPE = "glitch";

/** How long the GM waits for the player's Wheel (ms), and a player for the GM. */
export const WHEEL_TIMEOUT_MS = 5 * 60_000;
export const REQUEST_TIMEOUT_MS = 30_000;

/** The glitch screen on every client. */
export const FX_MS = 3600;

/** Journal folder for the tracker page when Planar Codex is not installed. */
export const TRACKER_FOLDER = "Planar Glitch";

/** Grey tint for the body left behind. */
export const CORPSE_TINT = "#6e6a78";
