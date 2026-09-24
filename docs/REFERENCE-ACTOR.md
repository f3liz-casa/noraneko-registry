---
order: 30
description: actor.ts(JS)で書く drop の細部。drop.toml の全部、ctx、matches の三つの形
---

# actor.ts で書く(JS)

Tsubaki の殻([REFERENCE-TSUBAKI](REFERENCE-TSUBAKI.md))で足りない drop は、
`actor.ts` を一枚書く。ここはその道の細部。ふだんは [GUIDE](GUIDE.md) で足りる。

## 置く場所

```text
drops/<name>/drop.toml               uuid / name / note / contact / actors(と [deps] / [compat])
drops/<name>/src/<actor>/actor.ts    書くのはこれ(actor はいくつでも)
drops/<name>/src/<actor>/view.tsx    view(preact)。触るものが増えたら io/ に出す(docs/LAYERS.md)
```

## drop.toml

`drops/_example/drop.toml` を写すのが早い。

```toml
uuid = "..."                # uuidgen | tr A-Z a-z で一つ振る。一度振ったら変えない(正体)
name = "hello"              # dir と同じ。この registry の中で一つ(札)
note = "何をする drop か、一行で"
contact = ["gh/you"]        # 困ったとき、誰に訊けばいいか(gh/ mail/ social/)
actors = ["hello"]          # src/<actor>/actor.ts

[deps]
std = "0064c162-13ac-458e-80ef-e73b1bc49a24"   # preact と mount、Tsubaki の runtime(札 = uuid。版は build が固定)
[compat]
std = "1"                   # 1.x でよい(Julia と同じ読みかた)
```

`deps` / `compat` の読みかたと台帳の仕組みは [LAYERS](LAYERS.md)。

## actor.ts の形

```ts
import { defineContent, defineParent, type ActorMeta } from "../_shared/defineActor.ts";

export const meta: ActorMeta = {
  id: "hello@example.org",          // 拡張の id
  version: "1.0.0",
  namespace: "hello",               // 名前(いまは表示だけ)
  matches: ["about:newtab*"],       // content が動くページ(JSWindowActor の matches)
  runAt: "document_end",            // document_start / document_end / document_idle
};

// メインプロセスで動く。Services も ChromeUtils も使える(= 何でもできる。だからレビューはここを一番読む)
export const parent = defineParent({
  async count(): Promise<number> { return 1; },
});

// ページ側。window / document をそのまま使える。parent.xxx() はメインプロセスへの往復(Promise)
export const content = defineContent<typeof parent>((parent, ctx) => {
  window.addEventListener("DOMContentLoaded", async () => {
    const n = await parent.count();
    document.title = `hello ${n}`;
  });
});
```

三つの export を名前で出す。build が `parent` と `content` を別々に束ねる(ページ側の bundle にメインプロセスのコードは入らない、その逆も)。

## 約束

- **module の top level は純粋に。** `Services` / `ChromeUtils` / `window` などは関数の中だけで触る。build が `meta` を読むために Deno で import するので、top level で触ると build が落ちる。
- **置くのは `ctx.io` と `mount` を通す。** `import { h, mount } from "std"`。host を置いて preact で描く。外したとき、置いたものは自分で戻る([LAYERS](LAYERS.md))。`_shared/` は tooling のもので、drop から足せない。CSS は文字列で持って `ctx.io.style`。
- **読める形で。** build は minify しないし、一行 400 字を超える JS があれば断る。preact は `std` から来る(drop に同梱されない)。他の依存を持ち込むなら、library drop にするか、その source を自分の src に写す(vendored で見える形)。
- **短く。** DOM を触るのは JS で間違いないけれど、JS の分量は最小に。大きい logic は将来 WASM(`.tsubaki`)に分ける絵。

## ctx にあるもの

- `ctx.expose({ fn })` — ページの `window` に関数を生やす(exportFunction)。
- `ctx.io.place / style / listen / pref / defer` — 置くと、戻しかたが台帳に積まれる。**置くのはここを通す。**
- `mount(ctx.io, view, at)`(std)— host を置いて preact で描く。外れるとき view の unmount → host の remove。
- `ctx.ops` — `[deps]` に `std` があれば Tsubaki の runtime。`await ctx.ops.load("ops/x.tsubaki")` → `ctx.ops.call("f", ...)`。
  Tsubaki の中からは `jsglobal("console")` で sandbox の global に手が届く(`std-tsubaki-runtime` 0.2.0 から)。
  あるのは `console` / `fetch` / `URL` / `TextDecoder` / `TextEncoder` と、glue のための偽の `document` だけ。
  窓の DOM はここには無い(そこは `ctx.io` と `mount` の仕事)。
- `ctx.onDestroy(fn)` — 上で表せないものを、手で戻すとき。
- `ctx.dev` — dev build なら true。

## 三つの形

| 形 | matches | 例 |
|---|---|---|
| ページに特権のデータを渡す | `about:newtab*` など | `drops/newtab`(NewTabUtils のデータを event で渡す) |
| ページに関数を生やして双方向 | `chrome://noraneko-settings/*` など | noraneko の `settings-bridge`(pref の読み書き) |
| **ブラウザの窓そのものに UI を置く** | `chrome://browser/content/browser.xhtml` | `drops/webpanel`(タブの横にウェブページ。JS は一行も無い) |

三つ目は特別。`matches` に `chrome://browser/` を書くと、build が `includeChrome: true` を付け、content hook が
**ブラウザの窓の中で**動く(`window` は ChromeWindow。`gBrowser` も `Services` も手の届くところ)。

- `await window.delayedStartupPromise` してから触る(gBrowser が揃うのを待つ)。
- `chromehidden` に toolbar が入る窓(popup)では何もしない。
- Firefox は `#browser` の子を CSS `order` 1〜7 で並べている。右に置くなら 8 以降。
- 置いたもの(DOM、style、observer、listener)は **`ctx.io` / `mount` を通す**と自分で戻る。外したあとに残るのは、いちばん嫌なこと。
- `<browser>` は preact に作らせてよい(std-preact-xul 1.1.0 から、並び替えが `moveBefore` = 取り出さない移動になった。`insertBefore` は同じ位置へでもページを作り直す)。ただし **`key` を必ず**。actor.ts を書いて手で持つ道も閉じてはいない。
- 入れる人の画面には「ブラウザの窓そのものに効く」と出る。渡す力が大きいぶん、レビューも重い。

> 三つ目の形を JS なしで書くのが [Tsubaki の道](REFERENCE-TSUBAKI.md)。
