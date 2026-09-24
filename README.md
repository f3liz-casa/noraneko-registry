# noraneko-registry

[日本語](README.ja.md)

The ledger of noraneko's **drops** — features that fall from a single piece of code. A drop is an xpi (a container) plus a JSWindowActor, the same shape as Firefox's own `about:newtab`. What we put first is not "someone signed it, so install it" but "the person installing can read what's inside." The signatures here are testimony, not a gatekeeper.

## Shape

Everything stays inside the registry. The drop's **source itself** lives here; the build happens here; the signature is made here. No outside repo is used.

1. An author puts `drops/<name>/drop.toml` (uuid, name, note, contact, actors) and `drops/<name>/src/<actor>/actor.ts` in a PR.
   The PR's diff is exactly "the source that becomes the xpi," so the review reads it.
   The identity is the `uuid` (one from `uuidgen`; once set, never changed); `name` is the label (the same as the dir; unique within this registry).
   Same picture as Julia's General: the same name in another registry is a different thing if the uuid differs.
2. CI builds with `tooling/` (the build tools vendored from noraneko, pinned by commit) — reproducibly.
3. A person reviews it (the gate is a PR review against this repo's main).
4. Once it lands on main, CI builds, copies the contact into the manifest, presses a keyless signature onto `manifest.json` under the registry's identity,
   and POSTs it together with the xpi to `dl.f3liz.casa/drop/<uuid>`. The receiving side (a Cloudflare Worker) verifies that signature, the xpi's sha256, and the uuid before
   writing to B2, and on the way out returns only what the signature passes. This repo holds no B2 key (the signature itself is the gate). `attestations.json` carries the Rekor and run links.
   The manifest's `source` is "this registry, this commit, `drops/<name>/src`," and the source is bundled inside the xpi too.
5. The browser (noraneko) holds a **list of registries** (this repo by default; you can add and remove them in settings — the same picture as alternative app stores on iOS).
   Enter a uuid (it asks the registries in the list in order and downloads from the first that has it), and it checks the integrity (sha256) and "is it signed under that registry's identity,"
   then shows the permission sheet, the source, the files that will actually run, and the contact. Green if it all lines up, red if not (it does not stop you). Then you decide to install.

## Locally

```
mise install
npm install
mise exec -- ruby scripts/dev.rb drops/<name>                   # the loop while writing (watch, build, put on the shelf)
mise exec -- ruby scripts/build.rb drops/<name>                 # build once. xpi and manifest in _build/<name>/
node scripts/verify.mjs drops/<name>/manifest.json.sigstore.json drops/<name>/manifest.json <registry identity>
```

- `scripts/dev.rb`: watches `drops/<name>/` and the shell, rebuilds with `build.rb --dev` on change, and puts it on your local shelf with `shelf.rb`.
  `--dev` adds a fourth number to the version (the rebuild mark), so **the same version never changes bytes underneath you**
  — you can see it without rebuilding the browser. CI does not pass this flag (the reproducibility promise stands).
- `scripts/build.rb`: lays `tooling/webext-actors` and `drops/<name>/src` out in `_stage/`, builds, and turns it into an xpi with `scripts/build-drop.rb`.
  The steps you can trace by hand are in `docs/BUILD.md`; the traps we hit are in `docs/TRAPS.md`. **If you are making your first drop, read `docs/GUIDE.md`.**
  How things are placed (the promise that removal restores what was there) and the layers, dependencies, and compat are in `docs/LAYERS.md`.
  **The table of what a drop is allowed to do (permission / effect / fact) is `docs/ABI.md`.**
  **What `std` brings and the words your logic writes with is `docs/STD.md`.**
- `docs/language.md` and `docs/for-drops.md` in [nyanrus/tsubaki](https://github.com/nyanrus/tsubaki) are the language side:
  the same Tsubaki a drop's logic is written in, at the depth a drop needs (state, action, `view`, effects).
- `scripts/verify.mjs`: the official `@sigstore/verify` (Node). Down to Fulcio's chain, Rekor v1/v2, TSA, and SCT.
- The verifier inside the browser is `@freedomofpress/sigstore-browser` (noraneko's `modules/sigstore/`).

## Learn more

- **Your first drop**: [GUIDE](docs/GUIDE.md) — where things go, the smallest Tsubaki, running it locally, publishing
- **What lives where**: [LAYOUT](docs/LAYOUT.md) — drop locations, build artifacts, what the browser holds
- **Signatures, and who decides**: [TRUST](docs/TRUST.md) — the root of trust, the PR gate, the reproducibility promise
- **Build by hand**: [BUILD](docs/BUILD.md) / **Layers and cleanup**: [LAYERS](docs/LAYERS.md)
- **Connect the local shelf**: [SHELF](docs/SHELF.md) / **Traps**: [TRAPS](docs/TRAPS.md)
