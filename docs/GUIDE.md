# drop を作る(はじめての人へ)

drop は、noraneko に **コード一つで降ってくる機能**。中身は小さな xpi(入れ物)と JSWindowActor(ページや窓への道)で、
Firefox 自身の about:newtab と同じ形。書くのは `actor.ts` **一枚**だけ。build も判も、この registry がやる。

いちばん前に置いているのは「入れる本人が中身を読める」こと。だから、読める形で書く(minify 無し、一枚、依存を持ち込まない)。
PR の diff がそのまま「実際に xpi になる source」で、レビューはそれを読む。

## 1. 置く場所

```
drops/<name>/drop.toml               uuid / name / note / contact / actors(と [deps] / [compat])
drops/<name>/src/<actor>/actor.ts    書くのはこれ(actor はいくつでも)
drops/<name>/src/<actor>/view.tsx    view(preact)。触るものが増えたら io/ に出す(docs/LAYERS.md)
```

`drop.toml` は `drops/_example/drop.toml` を写す。

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

## 2. actor.ts の形

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

**約束**

- **module の top level は純粋に。** `Services` / `ChromeUtils` / `window` などは関数の中だけで触る。build が `meta` を読むために Deno で import するので、top level で触ると build が落ちる。
- **置くのは `ctx.io` と `mount` を通す。** `import { h, mount } from "std"`。host を置いて preact で描く。外したとき、置いたものは自分で戻る(`docs/LAYERS.md`)。`_shared/` は tooling のもので、drop から足せない。CSS は文字列で持って `ctx.io.style`。
- **読める形で。** build は minify しないし、一行 400 字を超える JS があれば断る。preact は `std` から来る(drop に同梱されない)。他の依存を持ち込むなら、library drop にするか、その source を自分の src に写す(vendored で見える形)。
- **短く。** DOM を触るのは JS で間違いないけれど、JS の分量は最小に。大きい logic は将来 WASM(`.tsubaki`)に分ける絵。

`ctx` にあるもの:

- `ctx.expose({ fn })` — ページの `window` に関数を生やす(exportFunction)。
- `ctx.io.place / style / listen / pref / defer` — 置くと、戻しかたが台帳に積まれる。**置くのはここを通す。**
- `mount(ctx.io, view, at)`(std)— host を置いて preact で描く。外れるとき view の unmount → host の remove。
- `ctx.ops` — `[deps]` に `std` があれば Tsubaki の runtime。`await ctx.ops.load("ops/x.tsubaki")` → `ctx.ops.call("f", ...)`。
  Tsubaki の中からは `jsglobal("console")` で sandbox の global に手が届く(`std-tsubaki-runtime` 0.2.0 から)。
  あるのは `console` / `fetch` / `URL` / `TextDecoder` / `TextEncoder` と、glue のための偽の `document` だけ。
  窓の DOM はここには無い(そこは `ctx.io` と `mount` の仕事)。
- `ctx.onDestroy(fn)` — 上で表せないものを、手で戻すとき。
- `ctx.dev` — dev build なら true。

## 3. 三つの形

| 形 | matches | 例 |
|---|---|---|
| ページに特権のデータを渡す | `about:newtab*` など | `drops/newtab`(NewTabUtils のデータを event で渡す) |
| ページに関数を生やして双方向 | `chrome://noraneko-settings/*` など | noraneko の `settings-bridge`(pref の読み書き) |
| **ブラウザの窓そのものに UI を置く** | `chrome://browser/content/browser.xhtml` | `drops/webpanel`(タブの横にウェブページ) |

三つ目は特別。`matches` に `chrome://browser/` を書くと、build が `includeChrome: true` を付け、content hook が
**ブラウザの窓の中で**動く(`window` は ChromeWindow。`gBrowser` も `Services` も手の届くところ)。

- `await window.delayedStartupPromise` してから触る(gBrowser が揃うのを待つ)。
- `chromehidden` に toolbar が入る窓(popup)では何もしない。
- Firefox は `#browser` の子を CSS `order` 1〜7 で並べている。右に置くなら 8 以降。
- 置いたもの(DOM、style、observer、listener)は **`ctx.io` / `mount` を通す**と自分で戻る。外したあとに残るのは、いちばん嫌なこと。`<browser>` だけは preact に作らせず、ref の箱に手で(`drops/webpanel/src/webpanel/io/browsers.ts`)。
- 入れる人の画面には「ブラウザの窓そのものに効く」と出る。渡す力が大きいぶん、レビューも重い。

## 3.5 actor.ts を書かない(actor も Tsubaki)

小さい drop なら、**JS を一行も書かない**でいい。`ops/*.tsubaki` と drop.toml の `[actor]` だけ置くと、
build がどの drop でも同じ殻(`tooling/webext-actors/_shared/tsubakiActor.ts`)を着せる。
`drops/hello-tsubaki` がそれ(ツールバーに数字、押すと増えて pref に残る)。

```toml
actors = ["hello"]          # src/hello/ops/*.tsubaki

[actor]
id = "hello-tsubaki@noraneko.app"
namespace = "noraHelloTsubaki"
version = "1.0.2"
matches = ["chrome://browser/content/browser.xhtml"]
run_at = "document_end"     # 既定
```

logic が答える door は三つ。返すのは全部データで、DOM も preact も出てこない:

```julia
setup() = Dict(
    "anchor" => Dict("at" => "parent", "selector" => "#nav-bar", "tag" => "hbox", "id" => "nora-hello"),
    "style"  => "#nora-hello label { ... }",
    "prefs"  => ["noraneko.hello.count"]      # 見ていてほしい pref
)

start(facts)     # facts = Dict("prefs" => Dict(名前 => 値), "url" => …)。最初の一枚
dispatch(action) # 次の一枚。押されたとき、pref が変わったとき(PrefChanged)
```

一枚 = `frame(view)` か `frame(view, effects)`。view は `el(tag, props, kids)` の木で、
`"on:command" => Action` の値は **closure ではなく action そのもの**(closure は postMessage を越えない)。
殻が押されたときにそれを `dispatch` へ渡す — そのとき、こちら側にしか分からないこと
(画面の座標、入力欄の字、押された key)を `__event` に入れて添える。
props はそのまま要素に渡る。inline style は `"style" => Dict("width" => "320px")` と Dict で
(字を連ねると `;` の混入を自分で見張ることになる)。

**置き場所が二つ以上あるとき**は `"anchor"` の代わりに `"anchors"` に名前をつけて並べ、
`view` はその名前で答える。窓の中の離れた二か所 — タブの横の列と、`#mainPopupSet` の下の
`<menupopup>` — は一本の木にできないので:

```julia
setup() = Dict("anchors" => [
    Dict("name" => "sidebar", "at" => "before", "selector" => "#tabbrowser-tabbox", "tag" => "hbox"),
    Dict("name" => "menu",    "at" => "parent", "selector" => "#mainPopupSet",      "tag" => "menupopup")
])

view(s) = Dict("sidebar" => …, "menu" => …)
```

殻が carry out できる effect は、いまのところ五つだけ:

| effect | すること |
| --- | --- |
| `SetPref(name, value)` | pref に書く |
| `OpenURL(url)` | web の URL をタブで開く |
| `Log(text)` | console に出す |
| `Ask(fields, action)` | 事実を訊いて、その名前の action で受け取る |
| `Measure(selector, action)` | 自分が置いたものを実測して、その action で受け取る |

**これで足りないものは actor.ts を書く**(その道は閉じない)。狭いのはわざと:
この一覧が、入れる人に「この drop は何ができるか」を約束する。

`Ask` と `Measure` は、命令ではなく質問。logic は事実を作らない、が守りたい線なので
(新しい uuid も、いま見ているタブの URL も、drag のあとに箱が実際になった幅も、
logic には分からない)、**action に穴を開けて殻に埋めさせるのではなく、訊いて、名前を
つけた action で返してもらう**。返事は普通の `dispatch` で来る:

```julia
update(s, a::AddClicked) = Step(s, [Ask(["uuid", "url"], "AddPanel")])
# → dispatch(Dict("__type" => "AddPanel", "uuid" => …, "url" => …))

update(s, a::DragEnded) = Step(s, [Measure("#nora-webpanel-box", "SetWidth")])
# → dispatch(Dict("__type" => "SetWidth", "width" => 321, "height" => 640))
```

いま訊ける事実は `"uuid"`(新しい uuid)と `"url"`(いま見ているタブの URL。
http/https でなければ `""`)。`Measure` の selector は **その drop が置いた host と
その中**だけを探す — 自分が描いたものを測る。

`VNode` / `el` / `frame` / effect たちは std のことば(`std-tsubaki-runtime` 0.6.0 以上の
`ops/std.tsubaki`)。`[deps]` に `std` を書けば付いてくる。

## 4. 手元で動かす

```
mise install && npm install
mise exec -- ruby scripts/build.rb drops/<name>      # _build/<name>/ に <actor>.xpi と manifest.json
unzip -l _build/<name>/<actor>.xpi                    # 中を見る(source/ も入っている)
```

build が通れば、noraneko の dev build で「入れる」まで試せる(判は無いので赤い「判なしでも入れる」になる。それでいい):

1. `_build/<name>/` を `http://127.0.0.1:8765/drop/<uuid>/` として配る(`mkdir -p reg/drop/<uuid> && cp _build/<name>/* reg/drop/<uuid>/ && (cd reg && python3 -m http.server 8765)`)。
2. noraneko の pref `noraneko.drops.registries` に `[{"name":"local","base":"http://127.0.0.1:8765/drop","identity":"local","issuer":"local"}]`。
3. `about:nora:settings#drop=<uuid>&registry=local` を開く。中身(source、実際に実行されるファイル、動くページ)が出る。「判なしでも入れる」で入る。再起動は要らない。
4. 外すのも settings から。**外したあと、窓に何も残っていないか**を見る。

BiDi で中を見る手(`--remote-allow-system-access`)は `docs/TRAPS.md` の「手元で見るとき」。

## 5. 出す

1. PR に `drop.toml` と `src/` だけを入れる(`manifest.json` などは CI が main で書く)。
2. CI(`verify`)が Linux で build する。手元の mac と **同じ sha256** が出ることが約束(ずれたら `docs/BUILD.md` で追う)。
3. 人がレビューする。読むのは: `parent` が何をするか、`content` がどこで動くか、fetch の向き先、eval の有無、chrome API。
4. main に入ると、管理者の承認のあとで CI が判を押し、`dl.f3liz.casa/drop/<uuid>/` に置く。カタログ(noraneko.f3liz.casa/drops/)は組み直しで載る。
5. 更新は同じ dir に PR。版は `<meta.version>.<commit の分>` で自動的に上がる。

名前は札で、uuid が正体。別の registry に同じ名前があっても uuid が違えば別のもの。似すぎる名前は断られる。

## 6. 困ったら

- 「動かない」の切り分け、踏んだ穴: `docs/TRAPS.md`
- xpi ができるまでを手でなぞる: `docs/BUILD.md`
- 形の元(なぜ JSWindowActor か、addon 式が駄目だった理由): noraneko の `browser-features/webext-actors/README.md`
- 実物: `drops/newtab`(一枚)、`drops/hello-tsubaki`(JS 無し)、`drops/newtab-hello`(view は preact、言葉は Tsubaki)、`drops/webpanel`(窓に UI を置く)
- 置きかた・層・依存関係・compat: `docs/LAYERS.md`
