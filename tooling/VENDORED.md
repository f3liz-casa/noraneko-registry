noraneko(f3liz-casa/noraneko)の rftr-bridge 7dc5c66f591808c086f2ec857e6e649547003b97 から vendor した build の道具。
- webext-actors/: build.ts、_shared/、tsdown の設定、deno.json(actor を _dist/<name>/ に固める。xpi は入れ物 + JSWindowActor。2026-09-08 に content script 式から替えた)
- scripts/build-drop.rb(tooling の外に置いてある): _dist の actor を xpi と manifest.json に(reproducible、syntax check、minify 禁止、source 同梱)
上げるときは同じ commit から丸ごと写して、この file の commit を更新する。
- webext-actors/deno.lock: 依存の版と integrity。上げるときは `deno install` で作り直して commit する。
