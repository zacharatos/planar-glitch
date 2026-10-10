# Development

## Layout

```
module.json              manifest (id = planar-glitch; the id is permanent once published)
scripts/
  main.mjs               hooks: init (settings, Glitch feature type, keybinding), ready (catalog, socket, api), toolbar, sheet hooks
  constants.mjs  settings.mjs  i18n.mjs
  util.mjs               pure rules (no Foundry globals), all unit-tested:
                         ladder, Wheel, catalog validation/merge, what fits an actor, candidates, resolve → plan, text, log Markdown
  state.mjs              catalog (shipped + imported pack), death records, serial()
  actor.mjs              actorInfo() snapshot for util.mjs, labels, language pool, owner, tokens
  deaths.mjs             the death record start to finish (GM side): record + body, Wheel, candidates, accept, return,
                         place, raised, another character, cancel; detection hooks; combat end; long rest
  apply.mjs              plan → documents (glitch feature + Active Effect + item ops) and the exact undo (mend), keep, recover, born items
  wheel.mjs              the player's Wheel window (ApplicationV2) and the d20 roll
  console.mjs            GM console (ApplicationV2): Deaths, Characters, Catalog, Log
  sheet.mjs              ⟲ / ◈ badges on sheet rows, the header death counter, "Mark as nexus" in the item context menu
  tracker.mjs            the Glitch Tracker journal page (a Planar Codex note when the Codex is active)
  fx.mjs                 the glitch screen overlay
  rpc.mjs                socket: player -> GM requests, GM -> player prompts, fx broadcast
data/default-catalog.json  the shipped glitches (en + el), no publisher content
assets/glitch-1..5.svg   tier icons for glitch features (drawn for this module)
styles/glitch.css        scoped to .planar-glitch, .planar-glitch-card, .planar-glitch-fx, .pg-badge, .pg-counter
lang/en.json el.json     interface strings (keys under PLANAR_GLITCH.*)
tests/                   util (rules), flow (a death start to finish against a fake Foundry), manifest + languages + content guard, link, tools
tools/                   stamp-manifest, package, release-api, check-syntax
.github/workflows/       ci.yml, release.yml
```

There is no build step: Foundry loads `scripts/main.mjs` directly.

## How it fits together

- **Who writes.** Only the active GM's client writes. Every write to the records runs inside `serial()` (`state.mjs`), a promise queue; never call `serial()` inside a `serial()` block. The player's Wheel asks the GM for candidates with `call("candidates", …)`; the GM opens the Wheel with `ask(userId, "wheel", …)` and waits up to five minutes.
- **The flow.** `recordDeath` → status `dead` → `startWheel` (`asking` while the player decides) → `rolled` (candidates stored on the record, each with its resolved plan) → `accept` → `accepted` → `returnCharacter` applies the plan(s) → `returned` → `place` (canvas click) or `markPlaced`. Exits from any open status: `raised`, `replaced`, `cancelled`.
- **Plans are resolved before anyone sees them.** `resolve()` picks the ability, skill, item… against the actor's numbers at the time of the roll, so the text the player reads ("Wisdom 13 → 12") is exactly what lands. If the sheet changes between choosing and returning, the item ops skip missing items.
- **Undo data lives on the glitch feature.** `flags.planar-glitch.glitch.ops`: `restore` (full item snapshot; `mode` corpse/gone; `recovered`), `update` (`revert` data), `born` (item to delete). Ability/skill/language/damage/initiative/darkvision/HP changes are an Active Effect on the feature (`transfer: true`), so deleting the feature removes them.
- **Languages** are a Set on the actor; the effect overrides the whole set (JSON array) with priority 50 + death number, so a later language glitch already contains the earlier one. While such a glitch exists, languages added by other means are hidden by the override: Mend it, add the language, let the next glitch include it.
- **Data.**
  - Hidden world settings: `records` (`{schema, list: [record]}`), `pack` (imported pack or null), `trackerPage` (uuid).
  - Actor flags: `deaths` (deaths they came back from: the ladder), `nexus` (item ids).
  - Item flags: `glitch` (on glitch features: `entryId, kind, tier, vars, recordId, deathNo, date, ops, kept`), `touched` (items changed or born of a death).
  - Token flag: `corpse` (`recordId, actorId`).
- **The ladder** counts deaths the character *came back from* (`deaths` flag). A death undone by **Raised** or **Cancel** doesn't move it.

### Record shape

```
{ id, actorId, actorName, img, userId, sceneId, sceneName, tokenId, corpseTokenId,
  date, worldTime, cause, source: "saves"|"status"|"manual", deathNo, combatId,
  status, wheel: {roll, rerolled, base, tier, count, shift}, candidates: [{entryId, tier, plan, title, text, personal, lines, lang}],
  choice: index|"both"|null, pickedBy: "player"|"gm", glitches: [{itemId, title, tier, entryId}],
  returnMode: "spent"|"rested"|"wait", restReady, foundAt, fragment, placed, replacementId, replacement }
```

## Run the checks

```
npm test
```

Syntax check on every `.mjs`, then: the rules in `util.mjs`, a death start to finish (record, body, Wheel by GM and by player, return, left-behind + recover, Active Effect, unattune/fewer-uses + Mend, raised, cancel, keep/release, born items) against an in-memory fake of Foundry, the manifest, language parity and every key used in code, a content guard, a link test of `main.mjs`, and the release tools.

These tests do not start Foundry. Anything touching real documents, sheets, sockets, dialogs or the canvas has to be tried by hand.

## Try it in Foundry

Symlink the repo into your user data and restart the world:

```
ln -s /path/to/repo /path/to/FoundryData/Data/modules/planar-glitch
```

Reload the browser (F5) after each change. Use a second browser logged in as a player for the Wheel. Work on a **copy** of a character the first time.

### Manual test checklist

**Setup**
- Enable the module: no console errors; the spinning-arrows icon is in the GM's Tokens toolbar, not in a player's.
- Console → Characters lists the PCs. Choose a nexus from the dropdown. Right-click an item on the sheet → *Mark as nexus* / *Unmark nexus* (dnd5e context menu). The ◈ appears on the item's row.
- Catalog: the shipped list in five tiers. Pick a PC in *Who fits?*: ✔/✖ per glitch (e.g. *Dimmed Eyes* ✖ for a PC without darkvision).

**Death**
- PC at 0 HP fails a third death save: the console opens on a new card; the token is hidden; a grey "(body)" token stands in its place with the Dead overlay and an **empty** inventory; the PC's sheet is untouched.
- Mark the PC defeated in the combat tracker instead: same result, once (no second card).
- Record a death by hand from the Deaths tab.
- During combat the card says the fight is on; end the combat: a toast says they can come back.

**The Wheel (player online)**
- Turn the Wheel: the dialog opens on the player's screen with their portrait. Roll: the d20 is in chat (Dice So Nice if installed). A 1 says one tier worse; a 20 one tier lighter.
- With Heroic Inspiration on the sheet: *Spend Heroic Inspiration* rerolls once and clears the inspiration.
- Continue: two glitches with texts; pick one, *This one comes back*. The GM's card shows *Choosing*, the pick highlighted, *chosen by the player*, and the effect lines.
- Player closes the dialog: the GM gets "didn't choose", the card is back to Dead.
- GM presses *Stop waiting* while the player decides: the card moves on; the player's later answer is ignored.
- At tier V with a 1: "both of them come back"; both glitches apply.

**The Wheel (GM)**
- Roll here: chat d20, two candidates. *Choose this*, *New candidates* (different glitches, same tier), *Swap for…* (any entry of the tier; one that doesn't fit says so), edit the text (pen icon → Done).

**Return**
- Accept → return form. *After the next long rest*: Return disabled until a PC finishes a long rest (toast), or *Bring them back anyway*.
- Bring them back: click on the map (Esc cancels: the card then shows *Place on the map* and *Show the token where it is*).
  - The token appears where you clicked, snapped to the grid.
  - The player gets a whisper with the glitch.
  - Every client sees the glitch screen (turn it off per client in the settings).
  - The Soundboard *Return* pad plays if it's set.
- Sheet:
  - A new feature in a *Glitch* group with the tier icon and a ⟲ badge (tooltip: death number and date).
  - The description has the text and a meta line.
  - The header shows ⟲ n.
  - HP is at maximum (minus any *Hollow*); death saves are 0; *Dead* and *Unconscious* are gone.
  - Spell slots stay spent with the default return; *Fully rested* restores them.
- Mechanical glitches (use **Swap for…** to force each one):
  - *Faded*/*Cracked*/*Crumbling*: the ability on the sheet drops (Active Effect on the feature, ⟲ on the effect).
  - *Rebalanced*: two abilities swap.
  - *Someone Else's Training* / *Lost Knack*: proficiency dots change.
  - *Another Tongue* / *Lost Word*: the languages list changes.
  - *Changed Blood* / *Open Wound*: resistances and vulnerabilities.
  - *Slow to Wake*: initiative −2.
  - *Dimmed Eyes*: darkvision 0. **Check the senses path on dnd5e 6.**
  - *Hollow*: max HP lower.
  - *Left Behind*: the item is gone from the sheet and is in the body's inventory; **Recovered** brings it back with the same id and empties the body.
  - *Swallowed* / *Unmade Gift*: the item is gone.
  - *Forgotten Spell*: the spell is gone; drop a spell on the record's drop zone: it appears with a ⟲.
  - *Blunted*: the feature's max uses −1 (⟲ on its row).
  - *Unbound*: the attuned item is unattuned (⟲).
  - *Fading Self* / *Lost Heritage*: a feat or species trait is gone.

**Other exits**
- Raised: the body is removed, the token reappears where the body lay, death saves cleared, HP at least 1, no glitch; the log shows *Raised*.
- Another character: pick an actor → the player now owns it and has it as their character; click to place its token.
- Cancel: the body is removed, the token is back; the death disappears from the log and the ladder.

**Characters**
- Mend a glitch: it is gone and everything it changed is back (item ids preserved; the ⟲ on changed items disappears).
- End the glitch: Keep / Release per glitch. Kept glitches stay with a "kept" tag and badge; released ones are mended.

**Log**
- The tracker page is created after the first death (with Planar Codex: a Codex note; without: "Planar Glitch" folder, GM only). Rows update ~1.5 s after each change. Type a memory fragment in **Log**: it appears on the page. Copy as Markdown pastes the same table.

**Packs**
- Import a broken JSON: error toast, details in the console (F12), nothing saved. Import a valid pack: personal glitches show with their character tag; one of the two candidates is personal when one fits; reminders show on that character's death card.
- Export pack writes the imported pack (or an empty template).

## Changing things

- **New user-facing text:** add the key to `lang/en.json` and `lang/el.json`. The language test fails if they differ.
- **New glitch kind:** add it to `KINDS`, `poolsFor` and `resolve` in `util.mjs` (with tests), describe it in `effectLines` (`deaths.mjs`), and document it in the README table. Everything it changes must be undoable from the feature's flags or its Active Effect.
- **Catalog format:** `validateCatalog` checks what the engine relies on. A breaking change bumps `CATALOG_SCHEMA` and needs a note in the README and the changelog.
- **Records:** add fields freely (old records just lack them); a change of meaning bumps `RECORD_SCHEMA` with a migration on `ready`.

## Versions

Follow [SemVer](https://semver.org/). Update `CHANGELOG.md` first, then tag. Compatibility lives in `module.json` (`minimum`, `verified`); raise `verified` only after testing on that Foundry build.
