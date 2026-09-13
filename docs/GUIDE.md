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
| **ブラウザの窓そのものに UI を置く** | `chrome://browser/content/browser.xhtml` | `drops/webpanel`(タブの横にウェブページ。JS は一行も無い) |

三つ目は特別。`matches` に `chrome://browser/` を書くと、build が `includeChrome: true` を付け、content hook が
**ブラウザの窓の中で**動く(`window` は ChromeWindow。`gBrowser` も `Services` も手の届くところ)。

- `await window.delayedStartupPromise` してから触る(gBrowser が揃うのを待つ)。
- `chromehidden` に toolbar が入る窓(popup)では何もしない。
- Firefox は `#browser` の子を CSS `order` 1〜7 で並べている。右に置くなら 8 以降。
- 置いたもの(DOM、style、observer、listener)は **`ctx.io` / `mount` を通す**と自分で戻る。外したあとに残るのは、いちばん嫌なこと。
- `<browser>` は preact に作らせてよい(std-preact-xul 1.1.0 から、並び替えが `moveBefore` = 取り出さない移動になった。`insertBefore` は同じ位置へでもページを作り直す)。ただし **`key` を必ず**。actor.ts を書いて手で持つ道も閉じてはいない。
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

**鍵を一つ取るとき**は、置き場所に `"at" => "keyset"` を書く。`<key>` は窓の keyset の
直の子でないと Firefox が見てくれないので、そこだけ selector ではなく場所の名前で言う
(殻が `#mainKeyset` の隣に、この drop 自身の `<keyset>` を立てる)。

```julia
setup() = Setup(anchors = [
    Anchor(name = "mark", at = "parent", selector = "#browser", tag = "hbox", id = "nora-zen"),
    Anchor(name = "keys", at = "keyset", id = "nora-zen-keys")
])

view(s) = Dict("mark" => …, "keys" => el("key", Dict("combo" => "Accel+Alt+Z", "on:command" => Toggle())))
```

押しかたは `combo` の**一つの字**で書く。`keycode` / `key` / `modifiers` の三つに綴り直すのは殻で、
同じ字が drop.toml にも並ぶ:

```toml
[permissions]
keys = ["Accel+Alt+Z"]
```

`Accel` は、どこでも同じ指(Windows と Linux は Ctrl、macOS は Cmd)。`F2` のように名前のある鍵と、
`Z` のような一文字が書ける。**宣言に無い組み合わせは、その `<key>` だけ置かれない** — 他の鍵と
view の残りはそのまま動いて、console に一行出る。入れる人の画面には
「キーボードの Accel+Alt+Z を、この drop が受け取ります」と出る。


**ツールバーに置くとき**は `"at" => "toolbar"`。殻が CustomizableUI の widget を一つ作って、
それぞれの窓に自分のぶんを渡す:

```julia
setup() = Setup(anchors = [Anchor(at = "toolbar", area = "nav-bar", id = "nora-undo-closed-tab")])

view() = el("toolbarbutton", Dict("label" => t(:label), "on:command" => Undo()))
```

`area` は最初に置く場所で、書けるのは `abi/v1.json` の `toolbar_areas` にある名前
(`nav-bar` / `TabsToolbar` / `PersonalToolbar` / `widget-overflow-fixed-list`)。
知らない名前は `nav-bar` に落ちる。

**そのあとどこに居るのかは、drop には分からない。** 入れた人が customize mode で動かした場所を
ブラウザが覚えていて、drop が言えるのは「最初はここに」だけ。減らした機能ではなく、そういう
約束 ── 位置は入れた人のもの。

片づけも drop の仕事ではない。widget はアプリに一つで、窓を一つ閉じただけで全部の窓から
ボタンが消えては困るので、外すのは drop を外す側(`Drops.sys.mts`)がする。

**設定の一枚を持つとき**は `"at" => "settings"` を書いて、drop.toml の `matches` に
設定の頁も足す。about:nora:settings が、入っている drop ごとに空の箱を置いていて、
その drop の一枚がそこに入る:

```toml
[actor]
matches = ["chrome://browser/content/browser.xhtml", "chrome://noraneko-settings/*"]
```

```julia
setup() = Dict("anchors" => [
    Dict("name" => "sidebar", "at" => "before", "selector" => "#tabbrowser-tabbox", "tag" => "hbox"),
    Dict("name" => "settings", "at" => "settings")
])

view(s) = Dict("sidebar" => …, "settings" => …)
```

**置き場所のほうに行き先が書いてある**ので、窓の置き場所は設定の頁に出ないし、
設定の一枚は窓に出ない。view は、どちらでも同じ名前で答えればいい。

二つの document は logic を別々に持つ(memory は分け合わない)。**話が合うのは pref
のほう** -- 片方が `SetPref` すると、もう片方は見ていた pref が動いたのを聞いて、
その場で描き直る。窓どうしが前から合っているのと、同じ仕組み。

中身はいまの語彙だけで書ける(pref を読む・書く、view を描く)ので、足したのは場所だけ。
設定の頁は HTML の document なので、そこの view は `div` / `label` / `input` / `span`
で書く(窓のほうは XUL)。要らない drop は何も書かなくてよく、**空の箱は畳まれて出ない**。

殻が carry out できる effect は、いまのところ 13:

| effect | すること |
| --- | --- |
| `SetPref(name, value)` | 設定を書く ── 宣言 `prefs` |
| `OpenURL(url)` | web の URL をタブで開く(http/https だけ) ── 宣言 `open_url` |
| `Ask(fields, action)` | 事実を訊く(要る permission は facts の側) |
| `Measure(selector, action)` | 自分が置いたものの大きさを測る |
| `OpenPopup(selector, x, y)` | 自分が置いた menupopup を開く |
| `ReloadFrame(selector)` | 自分が置いた窓を読み込み直す ── 宣言 `web_frame` |
| `DoCommand(name)` | ブラウザの命令を一つ実行する ── 宣言 `commands` |
| `SetTabAttr(tab, name, value)` / `ClearTabAttr(tab, name)` | タブに、この drop の目印 ── 宣言 `tab_marks` |
| `SetTabValue(tab, key, value)` / `ClearTabValue(tab, key)` | タブに、この drop の覚書 ── 宣言 `tab_values` |
| `Prompt(tab, action, value, placeholder)` | 名札のところに、字を打つ欄 ── 宣言 `prompt` |
| `Log(text)` | console に一行 |

**これで足りないものは actor.ts を書く**(その道は閉じない)。狭いのはわざと:
この一覧が、入れる人に「この drop は何ができるか」を約束する。

**ブラウザ自身の命令**は `DoCommand` 一つで届く。名前は `abi/v1.json` の `commands` にある綴りで、
同じ名前を drop.toml にも並べる:

```toml
[permissions]
commands = ["back", "forward", "restore-last-tab"]
```

```julia
update(s, a::Run) = Step(s, [DoCommand("back")])
```

門は二つ。**宣言に有る**ことと、**表に有る**こと。どちらか片方でも欠けたらしない ──
綴りを間違えても、ブラウザの知らない口が開かない。入れる人の画面には、名前ではなく
表の日本語が並ぶ(「戻る、進む、閉じたタブを戻す」)。

**ブラウザ自身のページ**を窓に出すときは、`<browser>` に URL ではなく **名前**を書く:

```toml
[permissions]
web_frame = true
browser_pages = ["bookmarks", "history", "downloads", "library"]
```

```julia
el("browser", Dict("page" => "bookmarks"))
```

門は命令と同じ二つ ── **表に有る**ことと **宣言に有る**こと。だから drop は `chrome://` の綴りを
一度も書かないし、任意の chrome: を開く口にもならない。表は `abi/v1.json` の `browser_pages`。

読み込む窓の作りも変わる。**ブラウザ自身のページは remote な窓では開かない**ので、
殻がその場(親)で読む窓にする ── Firefox 自身のサイドバー(`#sidebar`)と同じ着せかた。
web の URL(`src`)のほうは今までどおり content の、別のプロセスの窓。

表は Floorp の mouse-gesture の 94 個から来ていて、`gecko-` を落とした綴りのまま。
ページを scroll する八つは content の actor が要るのでまだ無く、窓を開け閉めするものは
別の宣言になる。

### タブのこと

タブは、この drop が置いたものではない。だから触れるのは **自分が付けたもの**だけ ──
見える目印(attr)と、残る覚書(value)、それと名札のところに出す欄。タブそのものは
`id`(殻がこの窓のために鋳った不透明な字)としてしか見えない。

```toml
[permissions]
tabs = "read"        # 一覧を読む。開いた / 閉じた / 選ばれた を知る
tab_marks = true     # 自分の目印を付ける(CSS で拾える)
tab_values = true    # 自分の覚書を残す(閉じて開き直しても付いてくる)
prompt = true        # 名札のところに、字を打つ欄
```

```julia
setup() = Setup(
    anchors = [...],
    watch = Watch(tabs = ["open", "restore", "close", "select", "dblclick"]),
    tab_values = ["name"]        # 読み戻す覚書の鍵
)
```

出来事は一つの action にまとまって来る:

```julia
Dict("__type" => "TabsChanged", "kind" => "open", "tab" => そのタブ, "tabs" => 一覧)
```

一枚のタブは `Dict("id" =>, "index" =>, "title" =>, "url" =>, "pinned" =>, "selected" =>,
"muted" =>, "discarded" =>, "group" =>, "container" =>, "values" =>)`。
**`url` は `current_url` も宣言した drop にだけ**入る(それ以外は空の字)── `Ask("url")` と同じ線で、
「タブのことを読む」と「どこを見ているかを読む」は、入れる人にとって別の一文だから。

目印と覚書の名前は **短く書く**。`data-nora-<uuid>-name` / `nora.<uuid>.name` に伸ばすのは殻で、
生の CSS の中の `{attr}` も、殻がその接頭辞に書き換える:

```julia
SetTabAttr(id, "name", "ねこ")     # → .tabbrowser-tab[{attr}name]
SetTabValue(id, "name", "ねこ")    # → 再起動しても、そのタブに
```

だから drop は自分の uuid を一度も綴らないし、二枚の drop が互いの目印を消し合うことも、
Firefox 自身の覚書を踏むことも、構造的に起きない。

`Prompt` は、打ち終わると `Dict("__type" => action, "tab" => …, "value" => 打たれた字)` で返ってくる。
Escape で閉じたときは **何も来ない**(打っていた字はどこにも残らないので、届けてもすることが無い)。

**本体の menu に行を混ぜるとき**は `"at" => "menu"`:

```toml
[permissions]
menu = ["tabContextMenu"]
```

```julia
Anchor(name = "menu", at = "menu", menu = "tabContextMenu", id = "nora-rename-tab-menu")
```

行は popup の **末尾**に足される(本体の行は動かさない)。その menu が「何についての menu か」を
`abi/v1.json` が知っているので、**押されたタブの目印が host に写る** ── 名前のあるタブのときだけ
出したい行は、CSS の側で閉じられる:

```css
#nora-rename-tab-menu:not([{attr}name]) .nora-rename-clear { display: none; }
```

`popupshowing` は待てないので(worker の返事を待つあいだに popup は塗られてしまう)、
ここが一往復も要らないのは、そのための形。その行から起きた action には、どのタブのことかが
`__event` の `tab` に入って届く。

**tag も同じように決まっている。** view が名乗れるのは `_shared/vnode.ts` の `ELEMENTS`
にある顔ぶれだけ(箱、ラベル、ボタン、メニューの行 — どれも何も読み込まないし、何も走らせない)。
知らない tag は、その場で止まる。約束が「effect の一覧」で済むのは、要素のほうが
おとなしいからで、そこが開いていると「データと既知の殻を読めばいい」が成り立たない。
足したい要素があれば registry に PR を(読むのは、drop を読むのと同じ人たち)。

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

いま訊ける事実は `"uuid"`(新しい uuid)、`"url"`(いま見ているタブの URL。
http/https でなければ `""`)、`"tabs"`(この窓のタブの一覧)、`"tab"`(いま選ばれているタブ)。
あとの二つは `tabs = "read"` が要る。`Measure` の selector は **その drop が置いた host と
その中**だけを探す — 自分が描いたものを測る。

### ページを読み込む窓(`<browser>`)

一つだけ、宣言してから使う要素がある。drop.toml の `[actor]` に:

```toml
[actor]
...
web_frame = true      # view に <browser> を書ける
```

と書くと、view が `browser` を名乗れる。入れる人の画面には「ページを読み込む窓を置く」と
出る(`actor.json` の `webFrame`)。view が書くのは**どこに置くか・何を読むか**だけ:

```julia
el("browser", Dict("key" => p.id, "src" => p.url, "flex" => "1"))
```

`type="content"` / `remote="true"` などの「どんな窓か」を決める九つの属性は、
**殻が着せる**(`_shared/vnode.ts` の `WEB_FRAME_ATTRS`)。九つあれば一つ忘れるし、
これは view を書いていて忘れてよい種類のまちがいではないので。`src` は `OpenURL` と
同じ規則で http/https だけ — ほかは空の窓になる。

**`key` を必ず書く**。preact は key で「同じもの」を見分けて、位置が変わったときに
`moveBefore`(取り出さない移動)で動かす。key が無いと作り直しになって、読み込んだページが
消える。この移動は std-preact-xul 1.1.0 から(`<video>` や、字を打っている `<input>` も
一緒に助かる)。

`reload()` や、ページの題が変わったことを logic に伝える口は、まだ無い。要るなら
actor.ts を書く道がある。

### logic を分けたいとき(`import`)

`ops/` は一枚でなくていい。分けたぶんを `module` にして、`import` と書く:

```julia
# ops/Style.tsubaki
module Style
    sheet() = "…"
end

# ops/webpanel.tsubaki
import Style
setup() = Dict("style" => Style.sheet(), …)
```

**その `import` の一行が、読む順を決めている。** Tsubaki の `import Shapes` は
「訊いた file の隣の `Shapes.jl` / `Shapes.tsubaki` を読む」だけれど、drop の logic は
file の無い worker で動く。だから **読むのは build**(`tooling/webext-actors/build.ts` の
`opsFiles`): `using` / `import` の行をたどって、import されたほうを先に置く。drop が
走るときには module がもう有るので、`import` は何も探さずに見つける。

書き換えも貼り合わせもしない。**読まれる file は、書いた人が書いた file そのまま**
(xpi の `source/` と同じもの)。置き場所は `ops/` の中で横並び —— それが `import` の
探す場所だから、path を書くことも、dir を作ることも無い。

- 隣に無い名前を import したら、build が言う(実行時は何もしない)
- 互いを import していたら、build が止まる
- `include(...)` は drop の中では動かない(worker に読む file が無い)。分けるなら `import`

`VNode` / `el` / `frame` / effect たちは std のことば(`std-tsubaki-runtime` 0.7.0 以上の
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
- 実物: `drops/newtab`(一枚)、`drops/hello-tsubaki`(JS 無し、いちばん小さい)、`drops/newtab-hello`(view は preact、言葉は Tsubaki)、**`drops/webpanel`(JS 無しで窓に UI を置く。二か所の root、`Ask` / `Measure`、`<browser>`、`import` で二枚)**
- 置きかた・層・依存関係・compat: `docs/LAYERS.md`
