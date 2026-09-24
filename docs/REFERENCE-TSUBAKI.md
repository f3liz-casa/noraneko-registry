---
order: 20
description: 殻(std-actor)のリファレンス。door・anchor・effect・タブ・browser・import
---

# Tsubaki で書く(actor も Tsubaki)

小さい drop なら、**JS を一行も書かない**でいい。`ops/*.tsubaki` と drop.toml の `[actor]` だけ置くと、
build がどの drop でも同じ殻(lib の **std-actor**)を着せる。殻の bytes はその lib に一枚だけあって、
drop の xpi には入らない ── xpi に残るのは、その drop 自身の宣言と logic と、殻を呼ぶ数行。
`drops/hello-tsubaki` がそれ(ツールバーに数字、押すと増えて pref に残る)。

ここはその道の全部。はじめの一歩は [GUIDE](GUIDE.md)。殻で足りないときは [actor.ts の道](REFERENCE-ACTOR.md)。

## drop.toml の [actor]

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

`VNode` / `el` / `frame` / effect たちは std のことば(`std-tsubaki-runtime` 0.7.0 以上の
`ops/std.tsubaki`)。`[deps]` に `std` を書けば付いてくる。

## 置き場所

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

### 鍵を一つ取る

置き場所に `"at" => "keyset"` を書く。`<key>` は窓の keyset の直の子でないと Firefox が見てくれないので、
そこだけ selector ではなく場所の名前で言う(殻が `#mainKeyset` の隣に、この drop 自身の `<keyset>` を立てる)。

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

### ツールバーに置く

`"at" => "toolbar"`。殻が CustomizableUI の widget を一つ作って、それぞれの窓に自分のぶんを渡す:

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

### 設定の一枚を持つ

`"at" => "settings"` を書いて、drop.toml の `matches` に設定の頁も足す。
about:nora:settings が、入っている drop ごとに空の箱を置いていて、その drop の一枚がそこに入る:

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

## できること(effect)

殻が carry out できる effect は、いまのところ 18:

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
| `HideTab(tab)` / `ShowTab(tab)` | タブを仕舞う / また見せる ── 宣言 `tabs = "write"` |
| `SelectTab(tab)` | そのタブを選ぶ ── 宣言 `tabs = "write"` |
| `SetWindowValue(key, value)` / `ClearWindowValue(key)` | 窓に、この drop の覚書 ── 宣言 `window_values` |
| `Log(text)` | console に一行 |

**これで足りないものは actor.ts を書く**([REFERENCE-ACTOR](REFERENCE-ACTOR.md))。狭いのはわざと:
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

## タブのこと

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

`tabs` は **段のある宣言**。`"read"` は読むだけ、`"write"` はタブを選ぶ・仕舞う・また
見せるところまで。入れる人の画面には、その段の一文だけが出る。段が足りない drop は
**組むところで止まる**(`check-drop.rb` が、どの effect がその段を要っているかを言う)。

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
"hidden" =>, "muted" =>, "discarded" =>, "group" =>, "container" =>, "values" =>)`。
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

### タブを仕舞う、そして戻ってくるとき

タブを束にして切り替える drop(workspaces のような)は、三つを順に使う。順が大事です
── **先に選んで、あとで仕舞う**。選ばれているタブは本体が仕舞わないので、逆にすると
一枚だけ残ります。

```julia
SelectTab(id)     # 新しい束の、どれかを選ぶ
HideTab(id)       # 前の束のぶんを仕舞う
ShowTab(id)       # 新しい束のぶんを見せる
```

「いまどの束を開いているか」はタブ一枚に属さないので、**窓の覚書**に置きます
(`window_values`)。置き場所が窓なだけで、作法はタブの覚書と同じ:

```julia
setup() = Setup(
    window_values = ["ws"],          # 読み戻す鍵。start(facts) の `window` に入って届く
    tab_values = ["ws"],
    restore = Restore(hide_unless = "ws")
)
```

`restore` が、**前回から戻ってくるタブの迎えかた**。`marks` はその覚書を持って戻って
きたタブに同じ名前の目印を、`hide_unless` はその覚書が窓の覚書と違うタブを仕舞ったまま
戻します。戻ってきてから仕舞い直すのでも動きますが、そのときは **一瞬ぜんぶ見える**
── 本体は戻すタブをまとめて挿すので、殻はその同じ turn の中で焼きます。だから
**logic には訊かれません**(worker の返事を待つ時間が無い)。決めるのは logic、するのは殻。

`facts` に `window` が入っているかどうかは、「ここは窓か」の合図でもあります。設定の頁に
同じ logic が居るとき、そちらには窓のタブが無いので。

この drop が仕舞ったタブは、**drop を外すと見せて返します**(タブ帯から消えたタブを戻す道が、
外した人の手元に無くなってしまうので)。窓を閉じたときは返しません ── そのときの仕舞われかたは、
その窓の姿として SessionStore が持っていくものだから。

### 本体の menu に行を混ぜる

`"at" => "menu"`:

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

## 要素(tag)

**tag も同じように決まっている。** view が名乗れるのは殻(`drops/std-actor/src/lib/vnode.ts`)の `ELEMENTS`
にある顔ぶれだけ(箱、ラベル、ボタン、メニューの行 — どれも何も読み込まないし、何も走らせない)。
知らない tag は、その場で止まる。約束が「effect の一覧」で済むのは、要素のほうがおとなしいからで、
そこが開いていると「データと既知の殻を読めばいい」が成り立たない。
足したい要素があれば registry に PR を(読むのは、drop を読むのと同じ人たち)。

## 訊く(Ask と Measure)

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

## ページを読み込む窓(`<browser>`)

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
**殻が着せる**(`drops/std-actor/src/lib/vnode.ts` の `WEB_FRAME_ATTRS`)。九つあれば一つ忘れるし、
これは view を書いていて忘れてよい種類のまちがいではないので。`src` は `OpenURL` と
同じ規則で http/https だけ — ほかは空の窓になる。

**`key` を必ず書く**。preact は key で「同じもの」を見分けて、位置が変わったときに
`moveBefore`(取り出さない移動)で動かす。key が無いと作り直しになって、読み込んだページが
消える。この移動は std-preact-xul 1.1.0 から(`<video>` や、字を打っている `<input>` も
一緒に助かる)。

`reload()` や、ページの題が変わったことを logic に伝える口は、まだ無い。要るなら
actor.ts を書く道がある。

## logic を分けたいとき(`import`)

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
