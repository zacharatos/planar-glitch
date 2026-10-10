// The player's side of a death: the Wheel (a d20 everyone sees), Heroic Inspiration to reroll it,
// then two probable selves to choose from. Opened by the GM over the socket (prompt "wheel").
import { t } from "./i18n.mjs";
import { escapeHTML as esc, wheelTier } from "./util.mjs";
import { call } from "./rpc.mjs";

const { ApplicationV2 } = foundry.applications.api;

/** Roll the Wheel's d20 as a chat message (Dice So Nice shows it). Returns the result. */
export async function rollWheel(actor) {
  const roll = await new Roll("1d20").evaluate();
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: t("Wheel.Flavor", { name: actor?.name ?? "" }) });
  return roll.total;
}

export class WheelWindow extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "planar-glitch-wheel",
    classes: ["planar-glitch", "pg-wheel"],
    window: { title: "PLANAR_GLITCH.Wheel.Title", icon: "fa-solid fa-arrows-spin" },
    position: { width: 600, height: "auto" }
  };

  /** Open the dialog and wait. Resolves {choice} or null if closed. */
  static ask(payload) {
    return new Promise(resolve => { new WheelWindow(payload, resolve).render({ force: true }); });
  }

  #payload; #resolve; #stage = "intro"; #roll = null; #rerolled = false; #view = null;
  #picked = null; #busy = false; #boundTo = null; #error = "";

  constructor(payload, resolve) {
    super();
    this.#payload = payload;
    this.#resolve = resolve;
  }

  get #actor() { return game.actors.get(this.#payload.actorId); }

  async _prepareContext() { return {}; }
  async _renderHTML() { return this.#html(); }
  _replaceHTML(result, content) { content.innerHTML = result; }

  _onRender() {
    if (this.#boundTo === this.element) return;
    this.#boundTo = this.element;
    this.element.addEventListener("click", ev => this.#onClick(ev));
  }

  async close(options) {
    const r = this.#resolve;
    this.#resolve = null;
    r?.(null);
    return super.close(options);
  }

  #finish(answer) {
    const r = this.#resolve;
    this.#resolve = null;
    r?.(answer);
    this.close();
  }

  #html() {
    const p = this.#payload;
    const head = `<header class="pg-w-head">${p.img ? `<img src="${esc(p.img)}" alt="">` : ""}<div><h2>${esc(p.actorName)}</h2>
      <p>${esc(t("Wheel.DeathNo", { n: p.deathNo }))}</p></div></header>`;
    const err = this.#error ? `<p class="pg-error">${esc(this.#error)}</p>` : "";
    const busy = this.#busy ? "disabled" : "";
    if (this.#stage === "intro") {
      return `${head}<p class="pg-w-intro">${esc(t("Wheel.Intro"))}</p>
        <p class="pg-hint">${esc(t("Wheel.Base", { tier: p.tierName }))}</p>
        ${p.wheel ? `<p class="pg-hint">${esc(t("Wheel.Rules"))}</p>` : ""}${err}
        <footer><button type="button" class="primary" data-act="roll" ${busy}><i class="fa-solid fa-dice-d20"></i> ${esc(p.wheel ? t("Wheel.Turn") : t("Wheel.Continue"))}</button></footer>`;
    }
    if (this.#stage === "rolled") {
      const w = wheelTier(p.tier, this.#roll);
      const meaning = w.shift > 0 ? (w.count === 2 ? t("Wheel.Both") : t("Wheel.Worse")) : w.shift < 0 ? t("Wheel.Lighter") : t("Wheel.Same");
      const insp = !!this.#actor?.system?.attributes?.inspiration && !this.#rerolled && this.#roll !== 20;
      return `${head}<div class="pg-w-die ${w.shift > 0 ? "worse" : w.shift < 0 ? "lighter" : ""}">${this.#roll}</div>
        <p class="pg-w-meaning">${esc(meaning)}</p>${err}
        <footer>${insp ? `<button type="button" data-act="inspire" ${busy}><i class="fa-solid fa-star"></i> ${esc(t("Wheel.Inspiration"))}</button>` : ""}
        <button type="button" class="primary" data-act="candidates" ${busy}><i class="fa-solid fa-arrow-right"></i> ${esc(t("Wheel.Continue"))}</button></footer>`;
    }
    const v = this.#view;
    const cards = v.candidates.map((c, i) => `<button type="button" class="pg-w-card ${this.#picked === i || v.both ? "picked" : ""}" data-act="pick" data-i="${i}" ${v.both ? "disabled" : ""}>
        <h3>${esc(c.title)}</h3><p>${esc(c.text)}</p>${c.personal ? `<span class="pg-tag">${esc(t("Wheel.Personal"))}</span>` : ""}</button>`).join("");
    return `${head}<p class="pg-w-intro">${esc(v.both ? t("Wheel.BothIntro") : t("Wheel.ChooseIntro"))}</p>
      <p class="pg-hint">${esc(t("Wheel.TierNow", { tier: v.tierName }))}</p>
      <div class="pg-w-cards">${cards}</div>${err}
      <footer><button type="button" class="primary" data-act="confirm" ${v.both || this.#picked !== null ? "" : "disabled"}><i class="fa-solid fa-check"></i> ${esc(v.both ? t("Wheel.Accept") : t("Wheel.ThisIsMe"))}</button></footer>`;
  }

  async #onClick(ev) {
    const el = ev.target.closest("[data-act]");
    if (!el || el.disabled || this.#busy) return;
    ev.preventDefault();
    this.#error = "";
    try {
      switch (el.dataset.act) {
        case "roll":
          if (!this.#payload.wheel) return this.#fetch(null);
          this.#busy = true; this.render();
          this.#roll = await rollWheel(this.#actor);
          this.#stage = "rolled";
          break;
        case "inspire":
          this.#busy = true; this.render();
          await this.#actor.update({ "system.attributes.inspiration": false });
          this.#rerolled = true;
          this.#roll = await rollWheel(this.#actor);
          break;
        case "candidates": return this.#fetch(this.#roll);
        case "pick": this.#picked = Number(el.dataset.i); break;
        case "confirm": return this.#finish({ choice: this.#view?.both ? null : this.#picked });
      }
    } catch (err) {
      this.#error = err.message;
    }
    this.#busy = false;
    if (this.rendered) this.render();
  }

  async #fetch(roll) {
    this.#busy = true; this.render();
    try {
      this.#view = await call("candidates", { recordId: this.#payload.recordId, roll, rerolled: this.#rerolled });
      this.#stage = "choose";
    } catch (err) { this.#error = err.message; }
    this.#busy = false;
    if (this.rendered) this.render();
  }
}
