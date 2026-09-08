noraneko(f3liz-casa/noraneko)の rftr-bridge d3609dd04e5444e7f6cda5411f17ab0517ec3d70 から vendor した build の道具。
- webext-actors/: build.ts、_shared/、tsdown の設定、deno.json(actor を _dist/<name>/ に固める)
- build-drop.rb: _dist の actor を xpi と manifest.json に(reproducible、syntax check、minify 禁止、source 同梱)
上げるときは同じ commit から丸ごと写して、この file の commit を更新する。
