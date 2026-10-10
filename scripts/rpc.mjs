// Socket traffic. The active GM's client is the only one that writes; players answer.
//   request / response    player -> GM -> player  (e.g. "give me my two candidates")
//   prompt / prompt-reply GM -> player -> GM      (e.g. "turn your Wheel")
//   fx                    GM -> everyone          (play the glitch screen)
import { EVENT, REQUEST_TIMEOUT_MS, MODULE_ID } from "./constants.mjs";
import { t, warn } from "./i18n.mjs";

const handlers = new Map();
const promptHandlers = new Map();
const pending = new Map();
let fxPlayer = null;

/** Register a GM-side action handler: fn(payload, user) -> result. */
export const handle = (action, fn) => handlers.set(action, fn);
/** Register a player-side prompt: fn(payload) -> answer. */
export const onPrompt = (kind, fn) => promptHandlers.set(kind, fn);
export const setFxPlayer = fn => { fxPlayer = fn; };

const wait = (id, ms, fallback) => new Promise(resolve => {
  const timer = setTimeout(() => { pending.delete(id); resolve(fallback); }, ms);
  pending.set(id, value => { clearTimeout(timer); pending.delete(id); resolve(value); });
});

/** Run an action on the active GM's client and return its result. Throws with a readable message. */
export async function call(action, payload = {}) {
  const gm = game.users.activeGM;
  if (!gm) { warn("Notify.NoGM"); throw new Error(t("Notify.NoGM")); }
  if (gm.isSelf) return runHandler(action, payload, game.user);
  const id = foundry.utils.randomID();
  const reply = wait(id, REQUEST_TIMEOUT_MS, { ok: false, error: t("Notify.Timeout") });
  game.socket.emit(EVENT, { op: "request", id, from: game.user.id, to: gm.id, action, payload });
  const res = await reply;
  if (!res.ok) throw new Error(res.error);
  return res.result;
}

async function runHandler(action, payload, user) {
  const fn = handlers.get(action);
  if (!fn) throw new Error(`Unknown action ${action}`);
  return fn(payload, user);
}

/** GM side: ask one user something and wait (falls back to `fallback` on timeout or if they're offline). */
export async function ask(userId, kind, payload, fallback, ms) {
  if (!userId || userId === game.user.id) return (await promptHandlers.get(kind)?.(payload)) ?? fallback;
  const user = game.users.get(userId);
  if (!user?.active) return fallback;
  const id = foundry.utils.randomID();
  const reply = wait(id, ms ?? REQUEST_TIMEOUT_MS, fallback);
  game.socket.emit(EVENT, { op: "prompt", id, from: game.user.id, to: userId, kind, payload });
  return reply;
}

/** GM side: play the glitch screen on every client (and here). */
export function broadcastFx(data) {
  game.socket.emit(EVENT, { op: "fx", from: game.user.id, data });
  return fxPlayer?.(data);
}

export async function onMessage(msg) {
  if (!msg || typeof msg !== "object") return;
  const me = game.user.id;
  switch (msg.op) {
    case "request": {
      if (msg.to !== me) return;
      const user = game.users.get(msg.from);
      let res;
      try { res = { ok: true, result: await runHandler(msg.action, msg.payload ?? {}, user) }; }
      catch (err) { console.warn(`${MODULE_ID} |`, err); res = { ok: false, error: err?.message ?? String(err) }; }
      game.socket.emit(EVENT, { op: "response", id: msg.id, to: msg.from, ...res });
      break;
    }
    case "response":
    case "prompt-reply":
      if (msg.to === me) pending.get(msg.id)?.(msg.op === "response" ? msg : msg.answer);
      break;
    case "prompt": {
      if (msg.to !== me || !game.users.get(msg.from)?.isGM) return;
      const answer = await promptHandlers.get(msg.kind)?.(msg.payload);
      game.socket.emit(EVENT, { op: "prompt-reply", id: msg.id, to: msg.from, answer });
      break;
    }
    case "fx":
      if (game.users.get(msg.from)?.isGM) fxPlayer?.(msg.data);
      break;
  }
}

export function registerSocket() {
  game.socket.on(EVENT, onMessage);
}
