noraneko(f3liz-casa/noraneko)の rftr-bridge 92762a0939c5b29a3c5827cb64a5aa69adb4eaa2 から vendor した build の道具。
- webext-actors/: build.ts、_shared/(defineActor / contentRuntime / io / xul.d.ts の四つ。noraneko と
  同じ顔ぶれ)、tsdown の設定、deno.json(actor を _dist/<name>/ に固める。xpi は入れ物 + JSWindowActor。2026-09-08 に content script 式から替えた)
  **2026-09-14: 殻(tsubakiActor / vnode / style / commands と、それが読む表)を `_shared/` から
  `drops/std-actor/` へ出した。** あれは noraneko には無いもの(Tsubaki の drop のためだけの殻)で、
  どの drop の xpi にも一枚ずつ入っていた。lib にしたので、配られるのは一枚だけ。
  `_shared/` に残っている四つは noraneko と同じ顔ぶれなので、vendor し直しはそのまま写せる。
  `*_test.ts` は `test/` へ(試験は配らない)。
- scripts/build-drop.rb(tooling の外に置いてある): _dist の actor を xpi と manifest.json に(reproducible、syntax check、minify 禁止、source 同梱)
上げるときは同じ commit から丸ごと写して、この file の commit を更新する。
- webext-actors/deno.lock: 依存の版と integrity。上げるときは `deno install` で作り直して commit する。
- webext-actors/tsubakic/: Tsubaki の「畳むだけ」のビルド(nyanrus/tsubaki 6864653 の
  `_build/default/bin/tsubakic.bc.wasm.js` と `.assets/`)。ops/*.tsubaki を一枚の
  .tsb にする。同じ入力なら必ず同じバイトが出る。走らせる側の言葉は入っていない。
- drops/std-tsubaki-runtime/src/wasm/: 走らせるほう(同じ commit の `tsbvm/`、Rust)。
  `wasm-opt -Oz --enable-bulk-memory --enable-bulk-memory-opt --enable-nontrapping-float-to-int`
  をかけて 309,619 バイト。83c9a4a のときは 192,163 で、増えたぶんの三分の二
  (71,875)は builtin 四十(文字列・数・集まり)。使わない drop も一緒に
  落とすので、分けるかどうかは、そのうち決める。
