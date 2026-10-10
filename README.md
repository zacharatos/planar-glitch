# Planar Glitch

Death that changes you, for **Foundry VTT v14** and the **dnd5e** system (6.x). When a player character dies, the multiverse brings them back slightly wrong. They play the same character on the same sheet, and the sheet gains a **glitch**. The first deaths are cosmetic and roleplay; each further death costs more (ability scores, proficiencies, items, features, hit points). Every glitch is tagged on the character sheet and can be undone exactly, so a story can end it.

Built for campaigns where death is not the end but shouldn't be free: characters echoing other versions of themselves, cursed returners, anyone the planes keep spitting back.

## Features

- **Five tiers, one glitch per death.** The 1st death is a *Flicker* (roleplay only). The 2nd is a *Bleed* (a swap with no net loss). The 3rd is a *Drift* (a small cost), the 4th a *Fracture* (a real cost), and the 5th and later an *Unraveling* (a major cost).
- **The Wheel, on the player's screen.**
  - The player rolls a d20 that everyone sees: on a 1 the glitch is one tier worse, on a 20 one tier lighter. Heroic Inspiration can reroll it.
  - Then the player picks one of **two** glitches that fit their character.
  - The GM confirms, rerolls, swaps in any other entry, or rewrites the text.
- **The book's death rules, handled for you.**
  - **Detection:** a death is recorded on the third failed death save or the Dead status, or by hand.
  - **The body:** a grey, empty corpse token stays where they fell.
  - **Combat:** the return waits until the fight is over.
  - **Raised in time:** a *revivify* before the return means no glitch.
  - **Resources:** "full HP, spent resources stay spent", "fully rested" or "after the next long rest".
  - **Placing:** the GM clicks where the character turns up.
- **On the sheet.**
  - Each glitch is a feature in its own *Glitch* group. Glitches that change numbers do it with an Active Effect.
  - Anything born of a death or changed by one gets a **⟲** badge, with the death number and date in its tooltip.
  - The **nexus** (the one thing every version of the character keeps) gets a **◈** and is never touched.
  - A small death counter sits in the sheet header.
- **Undo, exactly.**
  - **Mend** reverts one glitch: scores, proficiencies, languages, items (same ids), uses, attunement.
  - Items "left on the body" can be **Recovered** when someone goes back for them.
- **End the glitch.** When the story says so, the player decides for each glitch whether to **Keep** it (it stays for good, marked as kept) or **Release** it (it is mended).
- **Another character.** If the player and GM decide on a new character instead, the console hands the player the other actor and places its token.
- **Death log.**
  - Every death goes on a **Glitch Tracker** journal page: date, character, death number, cause, where, Wheel roll, glitch, how they came back, where they were found, and a memory fragment the GM fills in.
  - With Planar Codex installed it is a Codex note, so it exports to your vault.
- **Your own glitches.**
  - The shipped list has about 35 glitches in English and Greek. Import a JSON pack to add your own.
  - Packs can add **personal** glitches for one character (one of the two candidates is always personal when one fits) and **GM reminders** shown on that character's death.
- **Extras:** a short glitch screen on every client when someone comes back, optional Planar Soundboard pads for death and return, a macro API and hooks.
- English and Greek interface.

The module ships no publisher content: no adventure text, art or audio.

## Install

In Foundry: **Add-on Modules → Install Module**, paste this manifest URL and press Install:

```
https://github.com/zacharatos/planar-glitch/releases/latest/download/module.json
```

Enable **Planar Glitch** in your world (Game Settings → Manage Modules). It needs the **dnd5e** system.

## Use

1. **Before play.** Open the console from the spinning-arrows icon in the Tokens toolbar. In **Characters**, choose each PC's **nexus** (or right-click an item on the sheet → *Mark as nexus*). Import your pack in **Catalog** if you have one.
2. **A PC dies.** The console opens on the death:
   - The token is hidden and the body is left on the map. Type how they died.
   - In a fight, the card says so; the return waits until the combat is ended.
3. **The Wheel.**
   - **Turn the Wheel** opens the dialog on the player's screen: they roll, may spend Heroic Inspiration, and choose.
   - **Roll here** does it in the console instead.
   - You see what each glitch does before anything changes. **Accept** when you're happy.
4. **Return.** Choose how they come back and where they were found, press **Bring them back**, then click the map where they turn up.
   - The glitch lands on the sheet and the player is whispered its text.
   - Everyone sees the glitch screen.
5. **Raised instead?** Press **Raised**: no glitch, the body goes, the token comes back where it lay.
6. **Later.**
   - **Log** holds every death (fill in memory fragments there).
   - **Characters** has **Mend** for single glitches and **End the glitch** for the finale.

## Writing a pack

A pack is one JSON file. The shipped list, [`data/default-catalog.json`](data/default-catalog.json), is a complete example.

```jsonc
{
  "schema": 1,
  "id": "my-campaign",
  "name": { "en": "My campaign", "el": "…" },
  "replaceDefault": false,              // true: use only this pack's glitches
  "tiers": [ { "tier": 1, "name": { "en": "Flicker" } } ],   // optional renames
  "glitches": [
    {
      "id": "kestrel-wrong-hand",       // unique; the same id as a shipped entry replaces it
      "tier": 1,                        // 1–5
      "kind": "note",                   // see below
      "params": {},                     // per kind
      "actors": ["Kestrel"],            // optional: only for these characters (full name or first word)
      "repeatable": false,              // optional: may be given more than once
      "title": { "en": "…", "el": "…" },
      "text":  { "en": "… {ability} …", "el": "…" }   // placeholders below
    }
  ],
  "reminders": [ { "actor": "Kestrel", "text": { "en": "Her charm hums when she returns." } } ]
}
```

| kind | params | placeholders |
|---|---|---|
| `note` | — | — |
| `ability-down` | `amount` (1), `count` (1) | `{ability} {from} {to}` (`{ability2} {from2} {to2}` with count 2), `{n}` |
| `ability-swap` | `maxGap` (2) | `{ability} {ability2} {from} {to}` |
| `skill-swap` / `skill-lose` | — | `{skill}` (`{skill2}` gained) |
| `language-swap` / `language-lose` | — | `{language}` (`{language2}` learned) |
| `resist-swap` | — | `{type}` vulnerability, `{type2}` resistance |
| `vulnerability` | — | `{type}` |
| `init-down` | `amount` (2) | `{n}` |
| `darkvision-lose` | — | `{n}` (the range lost) |
| `hp-down` | `perLevel` (1) | `{n}` |
| `lose-item` | `mode`: `corpse` (stays on the body) or `gone`; `magic`: true for magic items only | `{item}` |
| `forget-spell` | — | `{spell}` |
| `fade-feature` | `types`: `["feat"]` and/or `["race"]` | `{feature}` |
| `fewer-uses` | — | `{feature} {from} {to}` |
| `unattune` | — | `{item}` |

Glitches never lower an ability below 8, never touch class or subclass items, and never touch the nexus. A glitch that doesn't fit the character (no darkvision to lose, no spells to forget) isn't offered.

## Settings

| Setting | Default | |
|---|---|---|
| Death on three failed death saves | on | |
| Death on the Dead status | on | e.g. marked defeated in combat |
| Open the console on a death | on | |
| The player turns the Wheel | on | off: the GM rolls and chooses |
| Roll the Wheel | on | off: the tier comes from the death count only |
| Default return | full HP, spent stays spent | |
| Leave the body | on | |
| Glitch text language | automatic | language of the texts written to the sheet |
| Tracker page name | Glitch Tracker | |
| Soundboard pad: death / return | empty | names of Planar Soundboard pads |
| Glitch screen | on | per client |

## Macro API

```js
const api = game.modules.get("planar-glitch").api;
api.open();                                   // the console (GM)
await api.recordDeath(actor, { cause: "fell into the Abyss" });
api.glitches(actor);                          // glitch features on an actor
await api.mend(actor, itemId);                // undo one glitch
api.records();                                // every death record
api.catalog();                                // the active glitch list
api.playFx({ name: "Kestrel" });              // the glitch screen on this client
```

Hooks: `planar-glitch.death` (record), `planar-glitch.return` (record).

## Development

No build step. `npm test` runs the syntax check and the tests (rules, a full death-to-return flow against a fake Foundry, the manifest, language parity, and a link test). Layout, data shapes and the manual test checklist are in [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md); releases in [`docs/PUBLISHING.md`](docs/PUBLISHING.md).

## License

MIT. See [LICENSE](LICENSE).
