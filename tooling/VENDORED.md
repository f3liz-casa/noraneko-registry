noraneko(f3liz-casa/noraneko)の rftr-bridge 92762a0939c5b29a3c5827cb64a5aa69adb4eaa2 から vendor した build の道具。
- webext-actors/: build.ts、_shared/、tsdown の設定、deno.json(actor を _dist/<name>/ に固める。xpi は入れ物 + JSWindowActor。2026-09-08 に content script 式から替えた)
- scripts/build-drop.rb(tooling の外に置いてある): _dist の actor を xpi と manifest.json に(reproducible、syntax check、minify 禁止、source 同梱)
上げるときは同じ commit から丸ごと写して、この file の commit を更新する。
- webext-actors/deno.lock: 依存の版と integrity。上げるときは `deno install` で作り直して commit する。
- webext-actors/tsubakic/: Tsubaki の「畳むだけ」のビルド(nyanrus/tsubaki 430b38e の
  `_build/default/bin/tsubakic.bc.wasm.js` と `.assets/`)。ops/*.tsubaki を一枚の
  .tsb にする。同じ入力なら必ず同じバイトが出る。走らせる側の言葉は入っていない。
- drops/std-tsubaki-runtime/src/wasm/: 走らせるほう(同じ commit の `dropvm.bc.wasm.js`)。
  parser も effect handler も行列も入らない 263,213 バイト(前は main の 682,550)。
