// The glitch screen: a short distortion over the whole window with a title, on every client.
import { FX_MS } from "./constants.mjs";
import { setting } from "./settings.mjs";
import { escapeHTML as esc } from "./util.mjs";
import { t } from "./i18n.mjs";

export function playGlitch({ name = "", glitches = [] } = {}) {
  if (!setting("fx")) return;
  document.querySelector(".planar-glitch-fx")?.remove();
  const el = document.createElement("div");
  el.className = "planar-glitch-fx";
  el.setAttribute("aria-hidden", "true");
  el.lang = game.i18n?.lang ?? "en"; // Greek capitals drop their accents only when the language is known
  const title = t("Fx.Title");
  el.innerHTML = `<div class="pg-fx-noise"></div><div class="pg-fx-bars"></div>
    <div class="pg-fx-text"><div class="pg-fx-title" data-text="${esc(title)}">${esc(title)}</div>
    <div class="pg-fx-sub">${esc(t("Fx.Sub", { name }))}</div></div>`;
  document.body.append(el);
  el.addEventListener("click", () => el.remove());
  setTimeout(() => el.classList.add("out"), FX_MS - 600);
  setTimeout(() => el.remove(), FX_MS);
  return glitches;
}
