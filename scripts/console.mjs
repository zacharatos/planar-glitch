// The GM console: Deaths (the record for each death, start to finish), Characters (glitches, Mend,
// nexus, End the glitch), Catalog (pack import/export, what fits whom), Log (tracker rows).
import { MODULE_ID } from "./constants.mjs";
import { t, warn, info } from "./i18n.mjs";
import { setting } from "./settings.mjs";
import { escapeHTML as esc, sortRecords, isOpen, tally, isApplicable, remindersFor, RETURN_MODES, tierForDeath } from "./util.mjs";
import { catalog, importedPack, importPack, resetPack, records, record, local, tierName, serial } from "./state.mjs";
import { actorInfo, languagePool, playerCharacters, glitchItems, nexusIds, returnedDeaths, ownerUser } from "./actor.mjs";
import {
  recordDeath, startWheel, takeOver, rerollCandidates, chooseEntry, setChoice, setText, setField, accept, unaccept,
  returnCharacter, place, markPlaced, raised, cancelDeath, replaceCharacter, inCombat
} from "./deaths.mjs";
import { mend, keep, recover, giveBorn, waitingItems } from "./apply.mjs";
import { trackerMarkdown, trackerPage, syncTracker } from "./tracker.mjs";

const { ApplicationV2, DialogV2 } = foundry.applications.api;
const TABS = ["deaths", "characters", "catalog", "log"];
const TAB_ICONS = { deaths: "fa-skull", characters: "fa-users", catalog: "fa-book-skull", log: "fa-scroll" };

const btn = (act, icon, label, data = "", cls = "", extra = "") =>
  `<button type="button" class="${cls}" data-act="${act}" ${data} ${extra}><i class="fa-solid ${icon}"></i>${label ? ` ${esc(label)}` : ""}</button>`;
const when = iso => { try { return new Date(iso).toLocaleString(game.i18n.lang, { dateStyle: "short", timeStyle: "short" }); } catch { return String(iso ?? ""); } };

export class GlitchConsole extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "planar-glitch-console",
    classes: ["planar-glitch"],
    window: { title: "PLANAR_GLITCH.Console.Title", icon: "fa-solid fa-arrows-spin", resizable: true },
    position: { width: 780, height: 720 }
  };

  static #instance = null;
  static get instance() { return this.#instance; }

  static open({ recordId = null, tab = null } = {}) {
    if (!game.user.isGM) return warn("Notify.OnlyGM");
    this.#instance ??= new GlitchConsole();
    if (recordId) { this.#instance.#tab = "deaths"; this.#instance.#focus = recordId; }
    if (tab) this.#instance.#tab = tab;
    this.#instance.render({ force: true });
    this.#instance.bringToFront?.();
    return this.#instance;
  }

  #tab = "deaths";
  #focus = null;
  #previewActor = null;
  #editing = null; // "recordId:index" of a candidate whose text is being edited
  #boundTo = null;
  #timer = null;

  refreshSoon() {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      if (!this.rendered) return;
      // Don't redraw under the GM's typing.
      const active = document.activeElement;
      if (active && this.element.contains(active) && ["INPUT", "TEXTAREA"].includes(active.tagName)) return this.refreshSoon();
      this.render();
    }, 150);
  }

  async _prepareContext() { return {}; }
  async _renderHTML() { return this.#html(); }
  _replaceHTML(result, content) { content.innerHTML = result; }

  _onRender() {
    if (this.#boundTo === this.element) return;
    this.#boundTo = this.element;
    this.element.addEventListener("click", ev => this.#onClick(ev));
    this.element.addEventListener("change", ev => this.#onChange(ev));
    this.element.addEventListener("dragover", ev => { if (ev.target.closest(".pg-drop")) ev.preventDefault(); });
    this.element.addEventListener("drop", ev => this.#onDrop(ev));
  }

  /* ---------------- markup ---------------- */

  #html() {
    const open = records().filter(isOpen).length;
    const tabs = TABS.map(k => `<a class="pg-tab ${k === this.#tab ? "active" : ""}" data-tab="${k}"><i class="fa-solid ${TAB_ICONS[k]}"></i> ${esc(t(`Console.Tab.${k}`))}${k === "deaths" && open ? ` <span class="pg-count">${open}</span>` : ""}</a>`).join("");
    const body = { deaths: () => this.#deaths(), characters: () => this.#characters(), catalog: () => this.#catalog(), log: () => this.#log() }[this.#tab]();
    return `<nav class="pg-tabs">${tabs}</nav><section class="pg-body">${body}</section>`;
  }

  #deaths() {
    const all = sortRecords(records()).filter(r => r.status !== "cancelled");
    const open = all.filter(r => isOpen(r) || (["returned", "replaced"].includes(r.status) && !r.placed));
    const recent = all.filter(r => !open.includes(r)).slice(0, 8);
    const manual = `<div class="pg-row pg-manual"><select name="manualActor">${playerCharacters().map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select>
      ${btn("manual-death", "fa-skull-crossbones", t("Console.RecordDeath"))}<span class="pg-hint">${esc(t("Console.RecordDeathHint"))}</span></div>`;
    const cards = open.map(r => this.#card(r)).join("") || `<p class="pg-empty">${esc(t("Console.NoDeaths"))}</p>`;
    const past = recent.length ? `<h3 class="pg-sub">${esc(t("Console.Recent"))}</h3>${recent.map(r => this.#card(r, true)).join("")}` : "";
    return `${manual}${cards}${past}`;
  }

  #card(r, compact = false) {
    const actor = game.actors.get(r.actorId);
    const d = `data-record="${r.id}"`;
    const statusChip = `<span class="pg-status s-${r.status}">${esc(t(`Status.${r.status}`))}</span>`;
    const head = `<header>${r.img ? `<img src="${esc(r.img)}" alt="">` : ""}
      <div class="pg-who"><strong>${esc(r.actorName)}</strong>
      <span class="pg-chip">${esc(t("Console.DeathNo", { n: r.deathNo, tier: tierName(tierForDeath(r.deathNo)) }))}</span>${statusChip}
      <small>${esc(r.sceneName || "—")} · ${esc(when(r.date))}</small></div></header>`;
    if (compact) {
      const what = r.status === "returned" ? (r.glitches ?? []).map(g => g.title).join(", ") : r.status === "replaced" ? r.replacement : "";
      return `<div class="pg-card compact ${this.#focus === r.id ? "focus" : ""}" ${d}>${head}${what ? `<p>${esc(what)}</p>` : ""}</div>`;
    }
    const reminders = remindersFor(catalog(), r.actorName).map(x => `<li>${esc(local(x.text))}</li>`).join("");
    const combat = inCombat(r) ? `<p class="pg-warn"><i class="fa-solid fa-swords"></i> ${esc(t("Console.InCombat"))}</p>` : "";
    const cause = `<label class="pg-field">${esc(t("Console.Cause"))} <input type="text" data-field="cause" ${d} value="${esc(r.cause ?? "")}" placeholder="${esc(t("Console.CausePlaceholder"))}"></label>`;
    let body = "";
    switch (r.status) {
      case "dead": {
        const user = game.users.get(r.userId);
        const online = !!user?.active;
        const forPlayer = setting("askPlayer") && user;
        body = `<div class="pg-row">
          ${forPlayer ? btn("wheel-player", "fa-arrows-spin", t("Console.TurnWheelPlayer", { name: user.name }), d, "primary", online ? "" : `disabled data-tooltip="${esc(t("Console.Offline"))}"`) : ""}
          ${btn("wheel-gm", "fa-dice-d20", t("Console.RollHere"), d, forPlayer ? "" : "primary")}</div>`;
        break;
      }
      case "asking":
        body = `<p class="pg-hint"><i class="fa-solid fa-hourglass-half"></i> ${esc(t("Console.Asking", { name: game.users.get(r.userId)?.name ?? "—" }))}</p>
          <div class="pg-row">${btn("take-over", "fa-hand", t("Console.TakeOver"), d)}</div>`;
        break;
      case "rolled":
      case "accepted":
        body = this.#candidates(r) + (r.status === "rolled"
          ? `<div class="pg-row">${btn("reroll", "fa-shuffle", t("Console.Reroll"), d)}${btn("accept", "fa-check", t("Console.Accept"), d, "primary", r.choice == null ? "disabled" : "")}</div>`
          : this.#returnForm(r, d));
        break;
      case "returned":
      case "replaced": {
        const waiting = waitingItems(actor).filter(w => w.glitchItem.getFlag(MODULE_ID, "glitch")?.recordId === r.id);
        const glitches = (r.glitches ?? []).map(g => `<li><img src="${esc(actor?.items.get(g.itemId)?.img ?? "")}" alt=""> ${esc(g.title)} <small>(${esc(tierName(g.tier))})</small></li>`).join("");
        const items = waiting.map(w => `<li>${esc(w.name)} <small>${esc(t(w.mode === "corpse" ? "Console.OnBody" : "Console.Gone"))}</small>
          ${w.mode === "corpse" ? btn("recover", "fa-hand-holding", t("Console.Recover"), `${d} data-item="${w.glitchItem.id}" data-index="${w.index}"`) : ""}</li>`).join("");
        body = `${r.status === "replaced" ? `<p>${esc(t("Console.Replaced", { name: r.replacement ?? "" }))}</p>` : `<ul class="pg-glitches">${glitches}</ul>`}
          ${items ? `<ul class="pg-list">${items}</ul>` : ""}
          ${r.placed ? "" : `<div class="pg-row">${btn("place", "fa-location-crosshairs", t("Console.Place"), d, "primary")}${btn("placed", "fa-eye", t("Console.Unhide"), d)}</div>`}
          ${r.status === "returned" ? `<div class="pg-drop" ${d}><i class="fa-solid fa-hand-sparkles"></i> ${esc(t("Console.Drop"))}</div>` : ""}`;
        break;
      }
    }
    const exits = isOpen(r) ? `<footer class="pg-row pg-exits">
        ${btn("raised", "fa-heart-pulse", t("Console.Raised"), d, "", `data-tooltip="${esc(t("Console.RaisedHint"))}"`)}
        <select name="replaceWith" ${d}><option value="">${esc(t("Console.AnotherCharacter"))}</option>${game.actors.filter(a => a.type === "character" && a.id !== r.actorId).map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select>
        ${btn("replace", "fa-people-arrows", "", d, "icon", `data-tooltip="${esc(t("Console.ReplaceHint"))}"`)}
        ${btn("cancel", "fa-rotate-left", t("Console.Cancel"), d, "", `data-tooltip="${esc(t("Console.CancelHint"))}"`)}</footer>` : "";
    return `<div class="pg-card ${this.#focus === r.id ? "focus" : ""}" ${d}>${head}
      ${reminders ? `<ul class="pg-reminders"><i class="fa-solid fa-thumbtack"></i> ${reminders}</ul>` : ""}
      ${combat}${cause}${body}${exits}</div>`;
  }

  #candidates(r) {
    const w = r.wheel ?? {};
    const shift = w.shift > 0 ? t("Console.ShiftWorse") : w.shift < 0 ? t("Console.ShiftLighter") : "";
    const wheel = `<p class="pg-wheel-line"><i class="fa-solid fa-dice-d20"></i> ${w.roll ? esc(t("Console.Rolled", { roll: w.roll })) : esc(t("Console.NoRoll"))}${w.rerolled ? ` <span class="pg-tag">${esc(t("Console.Inspired"))}</span>` : ""}
      → <strong>${esc(tierName(w.tier ?? 1))}</strong>${shift ? ` <em>(${esc(shift)})</em>` : ""}${w.count === 2 ? ` <strong>${esc(t("Console.Both"))}</strong>` : ""}
      ${r.pickedBy ? `<small>· ${esc(t(r.pickedBy === "player" ? "Console.PickedByPlayer" : "Console.PickedByGM"))}</small>` : ""}</p>`;
    const tierEntries = catalog().glitches.filter(g => g.tier === (w.tier ?? 1));
    const locked = r.status === "accepted";
    const cards = r.candidates.map((c, i) => {
      const chosen = r.choice === "both" || r.choice === i;
      const key = `${r.id}:${i}`;
      const text = this.#editing === key
        ? `<textarea data-edit="${key}" rows="4">${esc(c.text)}</textarea>${btn("edit-done", "fa-check", t("Console.Done"), `data-record="${r.id}" data-i="${i}"`)}`
        : `<p>${esc(c.text)}</p>`;
      const swap = locked ? "" : `<div class="pg-row small">
          ${r.choice !== "both" && !chosen ? btn("choose", "fa-hand-pointer", t("Console.Choose"), `data-record="${r.id}" data-i="${i}"`) : ""}
          ${btn("edit", "fa-pen", "", `data-record="${r.id}" data-i="${i}"`, "icon", `data-tooltip="${esc(t("Console.EditText"))}"`)}
          <select data-swap="${r.id}" data-i="${i}"><option value="">${esc(t("Console.SwapFor"))}</option>${tierEntries.map(g => `<option value="${esc(g.id)}">${esc(local(g.title))}</option>`).join("")}</select></div>`;
      return `<div class="pg-cand ${chosen ? "chosen" : ""}">
        <h4>${esc(c.title)} ${c.personal ? `<span class="pg-tag">${esc(t("Console.Personal"))}</span>` : ""}<small>${esc(tierName(c.tier))}</small></h4>
        ${text}<ul class="pg-effects">${(c.lines ?? []).map(l => `<li>${esc(l)}</li>`).join("")}</ul>${swap}</div>`;
    }).join("");
    return `${wheel}<div class="pg-cands">${cards}</div>`;
  }

  #returnForm(r, d) {
    const modes = RETURN_MODES.map(m => `<option value="${m}" ${r.returnMode === m ? "selected" : ""}>${esc(t(`Return.${m}`))}</option>`).join("");
    const fight = inCombat(r);
    const restWait = r.returnMode === "wait" && !r.restReady;
    const blocked = fight || restWait;
    return `<div class="pg-form">
      <label class="pg-field">${esc(t("Console.ReturnMode"))} <select data-field="returnMode" ${d}>${modes}</select></label>
      <label class="pg-field">${esc(t("Console.FoundAt"))} <input type="text" data-field="foundAt" ${d} value="${esc(r.foundAt ?? "")}" placeholder="${esc(t("Console.FoundAtPlaceholder"))}"></label>
      ${restWait ? `<p class="pg-hint"><i class="fa-solid fa-bed"></i> ${esc(t("Console.WaitingRest"))}</p>` : ""}
      <div class="pg-row">${btn("back", "fa-arrow-left", t("Console.Back"), d)}
        ${btn("return", "fa-person-rays", t("Console.Return"), d, "primary", blocked ? "disabled" : "")}
        ${blocked ? btn("return-force", "fa-forward", t("Console.ReturnAnyway"), d) : ""}</div></div>`;
  }

  #characters() {
    const pcs = playerCharacters();
    if (!pcs.length) return `<p class="pg-empty">${esc(t("Console.NoPCs"))}</p>`;
    return pcs.map(a => {
      const n = tally(records(), a.id);
      const items = glitchItems(a);
      const nexus = nexusIds(a);
      const options = a.items.filter(i => !["class", "subclass", "race", "background", "spell"].includes(i.type) && !i.getFlag(MODULE_ID, "glitch"))
        .map(i => `<option value="${i.id}" ${nexus.includes(i.id) ? "selected" : ""}>${esc(i.name)}</option>`).join("");
      const list = items.map(i => {
        const g = i.getFlag(MODULE_ID, "glitch");
        return `<li><img src="${esc(i.img)}" alt=""> <a data-act="open-item" data-actor="${a.id}" data-item="${i.id}">${esc(i.name)}</a>
          <small>${esc(tierName(g.tier))} · ${esc(t("Console.DeathShort", { n: g.deathNo }))}</small>${g.kept ? ` <span class="pg-tag">${esc(t("Console.Kept"))}</span>` : ""}
          ${btn("mend", "fa-wand-magic-sparkles", "", `data-actor="${a.id}" data-item="${i.id}"`, "icon", `data-tooltip="${esc(t("Console.MendHint"))}"`)}</li>`;
      }).join("");
      return `<div class="pg-card"><header><img src="${esc(a.img)}" alt=""><div class="pg-who"><strong>${esc(a.name)}</strong>
          <span class="pg-chip">${esc(t("Console.Counts", { returned: returnedDeaths(a), logged: n.deaths, raised: n.raised }))}</span>
          <small>${esc(ownerUser(a)?.name ?? "")}</small></div>
          ${btn("open-sheet", "fa-id-card", "", `data-actor="${a.id}"`, "icon")}</header>
        <ul class="pg-glitches">${list || `<li class="pg-hint">${esc(t("Console.NoGlitches"))}</li>`}</ul>
        <div class="pg-row"><label class="pg-field">${esc(t("Console.Nexus"))} <select data-nexus="${a.id}"><option value="">—</option>${options}</select></label>
          ${items.length ? btn("end-glitch", "fa-infinity", t("Console.EndGlitch"), `data-actor="${a.id}"`) : ""}</div></div>`;
    }).join("");
  }

  #catalog() {
    const cat = catalog();
    const pack = importedPack();
    const pcs = playerCharacters();
    const who = game.actors.get(this.#previewActor) ?? null;
    const info = who ? actorInfo(who) : null;
    const pool = languagePool();
    const actorSelect = `<select name="previewActor"><option value="">${esc(t("Console.PreviewFor"))}</option>${pcs.map(a => `<option value="${a.id}" ${a.id === this.#previewActor ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select>`;
    const tiers = cat.tiers.map(tr => {
      const rows = cat.glitches.filter(g => g.tier === tr.tier).map(g => {
        const fits = info ? (isApplicable(g, info, { languagePool: pool }) ? `<i class="fa-solid fa-check pg-ok"></i>` : `<i class="fa-solid fa-xmark pg-no"></i>`) : "";
        return `<tr><td>${fits}</td><td><strong>${esc(local(g.title))}</strong>${g.actors?.length ? ` <span class="pg-tag">${esc(g.actors.join(", "))}</span>` : ""}<br><small>${esc(local(g.text))}</small></td><td><code>${esc(g.kind)}</code></td><td><small>${esc(g.source ?? "")}</small></td></tr>`;
      }).join("");
      return `<h3 class="pg-sub">${esc(local(tr.name))} <small>${esc(local(tr.hint))}</small></h3><table class="pg-grid"><tbody>${rows}</tbody></table>`;
    }).join("");
    const reminders = (cat.reminders ?? []).map(r => `<li><strong>${esc(r.actor)}</strong>: ${esc(local(r.text))}</li>`).join("");
    return `<div class="pg-card"><h3>${esc(local(cat.name) || cat.id)}</h3>
        <p class="pg-hint">${esc(pack ? t("Catalog.Imported", { name: local(pack.name) || pack.id }) : t("Catalog.Default"))}</p>
        <div class="pg-row">${btn("pack-pick", "fa-file-import", t("Catalog.Import"))}${btn("pack-export", "fa-file-export", t("Catalog.Export"))}${pack ? btn("pack-reset", "fa-rotate", t("Catalog.Reset")) : ""}</div></div>
      ${reminders ? `<div class="pg-card"><h3>${esc(t("Catalog.Reminders"))}</h3><ul class="pg-list">${reminders}</ul></div>` : ""}
      <div class="pg-row">${actorSelect}<span class="pg-hint">${esc(t("Catalog.PreviewHint"))}</span></div>${tiers}`;
  }

  #log() {
    const rows = sortRecords(records()).filter(r => r.status !== "cancelled").map(r => `<tr>
      <td>${esc(String(r.date).slice(0, 10))}</td><td>${esc(r.actorName)}</td><td>${r.deathNo}</td>
      <td>${esc(t(`Status.${r.status}`))}</td><td>${esc((r.glitches ?? []).map(g => g.title).join(", "))}</td>
      <td><input type="text" data-field="foundAt" data-record="${r.id}" value="${esc(r.foundAt ?? "")}"></td>
      <td><input type="text" data-field="fragment" data-record="${r.id}" value="${esc(r.fragment ?? "")}" placeholder="${esc(t("Console.FragmentPlaceholder"))}"></td></tr>`).join("");
    return `<div class="pg-row">${btn("page-open", "fa-book-open", t("Console.OpenPage"))}${btn("page-sync", "fa-arrows-rotate", t("Console.SyncPage"))}${btn("page-copy", "fa-copy", t("Console.CopyMarkdown"))}</div>
      <table class="pg-grid"><thead><tr><th>${esc(t("Tracker.Col.date"))}</th><th>${esc(t("Tracker.Col.character"))}</th><th>${esc(t("Tracker.Col.death"))}</th><th>${esc(t("Console.Status"))}</th><th>${esc(t("Tracker.Col.glitch"))}</th><th>${esc(t("Tracker.Col.found"))}</th><th>${esc(t("Tracker.Col.fragment"))}</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="7">${esc(t("Tracker.None"))}</td></tr>`}</tbody></table>`;
  }

  /* ---------------- events ---------------- */

  async #onChange(ev) {
    const el = ev.target;
    try {
      if (el.dataset.field && el.dataset.record) {
        await setField(el.dataset.record, el.dataset.field, el.value.trim());
        return;
      }
      if (el.dataset.swap && el.value) {
        await chooseEntry(el.dataset.swap, Number(el.dataset.i), el.value);
        return;
      }
      if (el.dataset.nexus) {
        const actor = game.actors.get(el.dataset.nexus);
        await actor?.setFlag(MODULE_ID, "nexus", el.value ? [el.value] : []);
        return;
      }
      if (el.name === "previewActor") { this.#previewActor = el.value || null; this.render(); }
    } catch (err) { ui.notifications.warn(err.message); this.refreshSoon(); }
  }

  async #onClick(ev) {
    const tab = ev.target.closest("[data-tab]");
    if (tab) { this.#tab = tab.dataset.tab; return this.render(); }
    const el = ev.target.closest("[data-act]");
    if (!el || el.disabled) return;
    ev.preventDefault();
    const id = el.dataset.record;
    const i = Number(el.dataset.i);
    const actor = game.actors.get(el.dataset.actor);
    this.#focus = id ?? this.#focus;
    try {
      switch (el.dataset.act) {
        case "manual-death": {
          const a = game.actors.get(this.element.querySelector("[name=manualActor]")?.value);
          if (a && await DialogV2.confirm({ window: { title: t("Console.RecordDeath") }, content: `<p>${esc(t("Console.RecordDeathConfirm", { name: a.name }))}</p>` })) {
            const rec = await recordDeath(a, { source: "manual" });
            if (!rec) warn("Notify.AlreadyOpen", { name: a.name });
          }
          break;
        }
        case "wheel-player": // runs until the player answers; the panel follows the record
          startWheel(id).catch(err => ui.notifications.warn(err.message)).finally(() => this.refreshSoon());
          break;
        case "wheel-gm": await startWheel(id, { byGM: true }); break;
        case "take-over": await takeOver(id); break;
        case "reroll": await rerollCandidates(id); break;
        case "choose": await setChoice(id, i); break;
        case "edit": this.#editing = `${id}:${i}`; break;
        case "edit-done": {
          const ta = this.element.querySelector(`textarea[data-edit="${id}:${i}"]`);
          if (ta) await setText(id, i, ta.value.trim());
          this.#editing = null;
          break;
        }
        case "accept": await accept(id); break;
        case "back": await unaccept(id); break;
        case "return":
        case "return-force": {
          const r = await returnCharacter(id);
          info("Notify.Returned", { name: r.actorName });
          await place(id);
          break;
        }
        case "place": await place(id); break;
        case "placed": await markPlaced(id); break;
        case "raised":
          if (await DialogV2.confirm({ window: { title: t("Console.Raised") }, content: `<p>${esc(t("Console.RaisedConfirm", { name: record(id)?.actorName ?? "" }))}</p>` })) await raised(id);
          break;
        case "cancel":
          if (await DialogV2.confirm({ window: { title: t("Console.Cancel") }, content: `<p>${esc(t("Console.CancelConfirm"))}</p>` })) await cancelDeath(id);
          break;
        case "replace": {
          const sel = this.element.querySelector(`select[name=replaceWith][data-record="${id}"]`);
          const other = game.actors.get(sel?.value);
          if (!other) return warn("Notify.PickCharacter");
          if (await DialogV2.confirm({ window: { title: t("Console.AnotherCharacter") }, content: `<p>${esc(t("Console.ReplaceConfirm", { from: record(id)?.actorName ?? "", to: other.name }))}</p>` })) await replaceCharacter(id, other.id);
          break;
        }
        case "recover": {
          const r = record(id);
          const owner = game.actors.get(r?.actorId);
          const g = owner?.items.get(el.dataset.item);
          if (g && await serial(() => recover(owner, g, Number(el.dataset.index)))) info("Notify.Recovered");
          break;
        }
        case "mend": {
          const item = actor?.items.get(el.dataset.item);
          if (item && await DialogV2.confirm({ window: { title: t("Console.Mend") }, content: `<p>${esc(t("Console.MendConfirm", { name: item.name, actor: actor.name }))}</p>` })) await serial(() => mend(actor, item));
          break;
        }
        case "end-glitch": await this.#endGlitch(actor); break;
        case "open-sheet": actor?.sheet?.render(true); break;
        case "open-item": actor?.items.get(el.dataset.item)?.sheet?.render(true); break;
        case "pack-pick": this.#pickPack(); break;
        case "pack-export": this.#exportCatalog(); break;
        case "pack-reset": if (await DialogV2.confirm({ window: { title: t("Catalog.Reset") }, content: `<p>${esc(t("Catalog.ResetConfirm"))}</p>` })) await resetPack(); break;
        case "page-open": { const page = await trackerPage() ?? await serial(syncTracker); page?.parent?.sheet?.render(true, { pageId: page.id }); break; }
        case "page-sync": await serial(syncTracker); info("Notify.Synced"); break;
        case "page-copy": {
          const md = trackerMarkdown();
          if (game.clipboard?.copyPlainText) await game.clipboard.copyPlainText(md); else await navigator.clipboard.writeText(md);
          info("Notify.Copied");
          break;
        }
      }
    } catch (err) {
      console.warn(`${MODULE_ID} |`, err);
      ui.notifications.warn(err.message);
    }
    this.refreshSoon();
  }

  async #onDrop(ev) {
    const zone = ev.target.closest(".pg-drop");
    if (!zone) return;
    ev.preventDefault();
    const TE = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
    let data;
    try { data = TE?.getDragEventData ? TE.getDragEventData(ev) : JSON.parse(ev.dataTransfer.getData("text/plain")); }
    catch { return; }
    if (data?.type !== "Item") return warn("Notify.DropItem");
    const item = data.uuid ? await fromUuid(data.uuid) : null;
    const rec = record(zone.dataset.record);
    const actor = game.actors.get(rec?.actorId);
    if (!item || !actor) return;
    const glitchItem = actor.items.get(rec.glitches?.[0]?.itemId) ?? null;
    await serial(() => giveBorn(actor, item.toObject(), { record: rec, glitchItem }));
    info("Notify.Born", { item: item.name, name: actor.name });
    this.refreshSoon();
  }

  /** Unity of Self: keep or release each glitch. */
  async #endGlitch(actor) {
    if (!actor) return;
    const items = glitchItems(actor);
    const rows = items.map(i => `<tr><td><strong>${esc(i.name)}</strong></td>
      <td><label><input type="radio" name="g-${i.id}" value="keep" ${i.getFlag(MODULE_ID, "glitch")?.kept ? "checked" : ""}> ${esc(t("Unity.Keep"))}</label></td>
      <td><label><input type="radio" name="g-${i.id}" value="release" ${i.getFlag(MODULE_ID, "glitch")?.kept ? "" : "checked"}> ${esc(t("Unity.Release"))}</label></td></tr>`).join("");
    const answer = await DialogV2.wait({
      window: { title: t("Unity.Title", { name: actor.name }) },
      classes: ["planar-glitch"],
      content: `<p>${esc(t("Unity.Intro"))}</p><table class="pg-grid">${rows}</table>`,
      buttons: [
        { action: "ok", label: t("Unity.Confirm"), default: true, callback: (e, b) => Object.fromEntries(items.map(i => [i.id, b.form.elements[`g-${i.id}`].value])) },
        { action: "cancel", label: t("Console.Cancel") }
      ],
      rejectClose: false
    }).catch(() => null);
    if (!answer || typeof answer !== "object") return;
    await serial(async () => {
      for (const i of items) {
        const item = actor.items.get(i.id);
        if (!item) continue;
        if (answer[i.id] === "keep") await keep(item);
        else await mend(actor, item);
      }
    });
    info("Notify.UnityDone", { name: actor.name });
  }

  /** The file input lives outside the panel: a re-render would replace it before the change event. */
  #pickPack() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.style.display = "none";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const errors = await importPack(data);
        if (errors.length) {
          ui.notifications.error(t("Catalog.Invalid", { n: errors.length }));
          console.warn(`${MODULE_ID} | pack problems:\n- ${errors.join("\n- ")}`);
        } else info("Catalog.Loaded", { name: local(data.name) || data.id });
      } catch (err) {
        ui.notifications.error(t("Catalog.BadJSON"));
        console.warn(`${MODULE_ID} | pack import failed`, err);
      }
      this.refreshSoon();
    }, { once: true });
    document.body.append(input);
    input.click();
  }

  #exportCatalog() {
    const data = importedPack() ?? { schema: 1, id: "my-pack", name: "My pack", glitches: [], reminders: [] };
    const save = foundry.utils.saveDataToFile ?? globalThis.saveDataToFile;
    save?.(JSON.stringify(data, null, 2), "application/json", `${data.id || "glitch-pack"}.json`);
  }
}

