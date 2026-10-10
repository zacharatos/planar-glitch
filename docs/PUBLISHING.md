# Publishing

Two separate steps. Step 1 gives you a working install link for anyone. Step 2 adds the module to Foundry's official package list, and is optional.

## 0. Before the first release

The placeholders are already filled in (`zacharatos`, `rkeytech`). The module `id` (`planar-glitch`) is permanent once published: it is the folder name on every user's server and the key for their saved data.

## 1. Publish on GitHub

1. Create an empty repository named `planar-glitch` on GitHub (public, no README, so nothing conflicts).
2. In this folder:
   ```
   git init -b main
   git add .
   git commit -m "Initial commit"
   git remote add origin git@github.com:zacharatos/planar-glitch.git
   git push -u origin main
   ```
3. CI (`.github/workflows/ci.yml`) runs `npm test` on every push.
4. Make a release: add a `## [0.1.0]` section to `CHANGELOG.md` (already there), then
   ```
   git tag v0.1.0
   git push origin v0.1.0
   ```
   `release.yml` runs the tests, builds `module.zip` and a stamped `module.json`, and attaches both to a GitHub release, using the changelog section as the notes.
5. Check that this URL downloads a JSON file:
   `https://github.com/zacharatos/planar-glitch/releases/latest/download/module.json`

That URL is what people paste into Foundry's **Install Module → Manifest URL** box. It always points at the newest release, so installs and updates need no further work from you.

The workflow overwrites `version`, `url`, `manifest`, `download`, `bugs`, `readme`, `changelog` and `license` in the released `module.json` from the tag and repo name, so you never edit those by hand for a release.

### Releasing later versions

1. Change the code, run `npm test`, try it in Foundry.
2. Add `## [0.2.0]` at the top of `CHANGELOG.md`.
3. Commit, `git tag v0.2.0`, `git push origin main v0.2.0`.

Make other versions of the module by branching (for example a `v2` branch for a Foundry version that needs a different code path) and using the same tag flow; set `compatibility` in `module.json` accordingly.

## 2. The official Foundry listing

Listing makes the module appear in Foundry's in-app **Install Module** search for everyone. Requirements and process, as published by Foundry:

- You need an active Foundry VTT license on your foundryvtt.com account.
- Submit through the Package Submission Form: <https://foundryvtt.com/creators/submit/>
- Modules and systems get a **manual review and approval**.
- You must own or have rights to everything you ship (the review checks art, icons, audio and third-party text). This module ships none, which keeps review simple. See Foundry's [licensing guide](https://foundryvtt.com/article/licensing-guide/).
- On the form you give the package id (`planar-glitch`), title, a description, and the **manifest URL** from step 1. Use the *latest* manifest URL for the listing. Check the form itself for the current list of fields.

### Foundry's AI content policy (read before submitting)

The code in this repo was written with AI assistance. Foundry's AI Content Policy (revised March 2026) applies to packages on the official listing. As of that revision it says, in short:

- You must **understand and be able to maintain** all AI-assisted code, you attest to that at submission, and you may be asked for commit history or design notes. "Vibe coding" is not allowed.
- **UI labels and other prepared written text must be human-authored.** That means `lang/en.json` and the other strings users read.
- The package **description on foundryvtt.com must be written by you**, not an AI.
- AI translation is allowed if a speaker of the language reviews it. `lang/el.json` needs your review.
- Documentation and tests may be AI-assisted.

Check the current wording before you submit, since policies change: search foundryvtt.com for "AI Content Policy". The policy does not restrict self-publishing through GitHub (step 1).

Practical to-do before submitting:

1. Read through every file in `scripts/` until you could explain and fix each one. `docs/DEVELOPMENT.md` has the map.
2. Rewrite `lang/en.json` in your own words (keep the keys and `{placeholders}`); `npm test` checks you did not break either.
3. Review `lang/el.json`.
4. Rewrite the `description` in `module.json` and write the listing text yourself.
5. Test every item in the manual checklist in `docs/DEVELOPMENT.md` on the Foundry version you list as `verified`.
6. Keep your commit history; do not squash it away.

### After approval: releasing versions to the listing

Once the package exists on foundryvtt.com, each new version must also be announced there. Either do it by hand from your package page, or automate it:

1. On foundryvtt.com open your profile's **Package Release API** token page and create an API token (starts with `fvttp_`).
2. In the GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**, name `FOUNDRY_PACKAGE_TOKEN`.
3. From then on, pushing a tag also runs `tools/release-api.mjs`, which posts the version, the version-specific manifest URL (`…/releases/download/vX.Y.Z/module.json`), the release notes link and the compatibility range.

Test it without publishing:

```
FOUNDRY_PACKAGE_TOKEN=fvttp_... node tools/release-api.mjs --version 0.1.0 --repo zacharatos/planar-glitch --dry-run
```

The release API manifest URL must be the one for that specific tag, not `latest`; the script does this for you.

## Checklist

- [ ] Placeholders replaced
- [ ] `npm test` passes
- [ ] Tried in Foundry v14 (manual checklist)
- [ ] Tag pushed, release has `module.json` and `module.zip`
- [ ] Manifest URL installs the module in a fresh world
- [ ] (Listing) You can maintain the code; strings and description are your own words
- [ ] (Listing) Submitted at foundryvtt.com/creators/submit
