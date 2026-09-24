---
order: 10
description: drop を作りはじめる人へ。置く場所、最小の Tsubaki、手元で動かす、出す
---

# drop を作る(はじめての人へ)

drop は、noraneko に **コード一つで降ってくる機能**。中身は小さな xpi(入れ物)と
JSWindowActor(ページや窓への道)で、Firefox 自身の about:newtab と同じ形。

いちばん前に置いているのは「入れる本人が中身を読める」こと。だから、読める形で書く
(minify 無し、一枚、依存を持ち込まない)。PR の diff がそのまま「実際に xpi になる source」で、
レビューはそれを読む。

書く道は二つ。ふつうは **Tsubaki**(JS を一行も書かない)。殻で足りないときだけ `actor.ts`(JS)を書く。
この頁は、Tsubaki で最小の drop を動かすまで。細部はリファレンスへ。

## 1. 置く場所

```text
drops/<name>/drop.toml                  uuid / name / note / contact / actors(と [actor] / [deps])
drops/<name>/src/<actor>/ops/*.tsubaki  決めることを書く(窓も pref も知らない。純粋)
```

`drop.toml` は `drops/_example/drop.toml` を写す。最小はこれだけ:

```toml
uuid = "..."                # uuidgen | tr A-Z a-z で一つ振る。一度振ったら変えない(正体)
name = "hello"              # dir と同じ。この registry の中で一つ(札)
note = "何をする drop か、一行で"
contact = ["gh/you"]        # 困ったとき、誰に訊けばいいか(gh/ mail/ social/)
actors = ["hello"]

[actor]
id = "hello@noraneko.app"
namespace = "noraHello"
version = "1.0.0"
matches = ["chrome://browser/content/browser.xhtml"]
run_at = "document_end"     # 既定

[deps]
std = "0064c162-13ac-458e-80ef-e73b1bc49a24"   # 殻と Tsubaki のことば
[compat]
std = "1"
```

`name` は札で、`uuid` が正体。別の registry に同じ名前があっても、uuid が違えば別のもの。
`deps` / `compat` の読みかたは [LAYERS](LAYERS.md)。

## 2. ops/main.tsubaki の形

書くのは一枚。殻が訊いてくる door は三つだけ。

```julia
# どこに置くか。ここでは #nav-bar の中で、hbox 一つ
setup() = Setup(
    anchors = [Anchor(at = "parent", selector = "#nav-bar", tag = "hbox", id = "nora-hello")]
)

# 押されたこと。それだけ
struct Bump end

# 描くもの。"on:*" の値は closure ではなく action そのもの
view() = el("label", Dict("value" => "こんにちは", "on:click" => Bump()))

start(facts) = frame(view())                    # 最初の一枚
dispatch(a) = frame(view(), [Log("押された")])   # 次の一枚と、してほしいこと
```

- `setup()` — どこに置くか、style、見ていてほしい pref。
- `start(facts)` — 最初の一枚。`facts` はもう本当のこと(pref や url)。
- `dispatch(action)` — 次の一枚と、してほしいこと(effect)。

返すのは全部データで、DOM も preact も出てこない。押されたときに殻が action を `dispatch` へ渡し、
こちらにしか分からないこと(座標、入力欄の字、押された key)を `__event` に添えて返す。

**決めるのは Tsubaki、するのは殻。** 窓に触るのは殻の仕事なので、drop は「どこに・何を」だけを言う。
置き場所の種類、effect の一覧、設定の一枚、タブ、`<browser>`、`import` は
[Tsubaki のリファレンス](REFERENCE-TSUBAKI.md) に全部あります。
実物は [`drops/hello-tsubaki`](../drops/hello-tsubaki/drop.toml)(いちばん小さい、JS 無し)と
[`drops/undo-closed-tab`](../drops/undo-closed-tab/src/undo-closed-tab/ops/undo-closed-tab.tsubaki)(押すと命令を一つ)。

## 3. 手元で動かす

```text
mise install && npm install
mise exec -- ruby scripts/dev.rb drops/<name>
```

これが**書いているあいだの輪**。`drops/<name>/` と殻を見張っていて、変わったら組み直して、
手元の棚(`http://127.0.0.1:8765/drop`)に置く。出るのは一行:

```text
14:32:05  hello 1.0.0.22138980 を組んだ(1.7 秒)
```

版の四つ目は「手元で組んだ印」。組み直すたびに動くので、同じ版のまま bytes だけ替わって
古い module が動く、という穴に落ちない(`docs/TRAPS.md`)。CI はこの旗を通らないので、
**reproducible の約束はそのまま**。

noraneko 側は一度だけ:

1. pref `noraneko.drops.registries` に
   `[{"name":"local","base":"http://127.0.0.1:8765/drop","identity":"local","issuer":"local"}]`
2. `about:nora:settings#drop=<uuid>&registry=local` を開く。中身(source、実際に実行される
   file、動くページ)が出る。判は無いので「判なしでも入れる」── 手元のものに誰も判を
   押していないのは本当のことなので、それでいい。
3. pref `noraneko.drops.dev.watch` に秒数(`3` くらい)。**手元の棚だけ**を見て、版が
   動いていたら静かに入れ直す。

これで、輪が閉じる:

```text
ops/main.tsubaki を保存 → 2 秒で組み上がる → 数秒で窓の中が新しくなる
```

ブラウザを建て直す必要はない。外すのも settings から ──
**外したあと、窓に何も残っていないか**を、ときどき見てください。

一度だけ組むときは `ruby scripts/build.rb drops/<name>`。実機で一周させる道具は
`ruby scripts/lap.rb drops/<name>`。詳しくは [BUILD](BUILD.md) と [TRAPS](TRAPS.md)。

## 4. 出す

1. PR に `drop.toml` と `src/` だけを入れる(`manifest.json` などは CI が main で書く)。
2. CI(`verify`)が Linux で build する。手元の mac と **同じ sha256** が出ることが約束(ずれたら [BUILD](BUILD.md) で追う)。
3. 人がレビューする。読むのは: 何をするか(`parent` / `content` の役割)、どこで動くか、fetch の向き先、eval の有無、chrome API。
4. main に入ると、管理者の承認のあとで CI が判を押し、`dl.f3liz.casa/drop/<uuid>/` に置く。カタログは組み直しで載る。
5. 更新は同じ dir に PR。版は `<meta.version>.<commit の分>` で自動的に上がる。

名前は札で、uuid が正体。別の registry に同じ名前があっても uuid が違えば別のもの。似すぎる名前は断られる。

## 5. もっと知る

- **Tsubaki のリファレンス**: [REFERENCE-TSUBAKI](REFERENCE-TSUBAKI.md) — 置き場所、18 の effect、タブ、設定、`<browser>`、`import`
- **actor.ts(JS)のリファレンス**: [REFERENCE-ACTOR](REFERENCE-ACTOR.md) — 殻で足りないときの道
- **層と片づけの約束**: [LAYERS](LAYERS.md) — `io/` の台帳、依存関係、compat
- **xpi ができるまで**: [BUILD](BUILD.md) / **罠**: [TRAPS](TRAPS.md) / **次にやること**: [NEXT](NEXT.md)
- **形の元**(なぜ JSWindowActor か、addon 式が駄目だった理由): noraneko の `browser-features/webext-actors/README.md`
- **実物**: [`drops/hello-tsubaki`](../drops/hello-tsubaki/drop.toml)(JS 無し、いちばん小さい)、
  [`drops/newtab`](../drops/newtab/drop.toml)(`actor.ts` 一枚)、
  [`drops/newtab-hello`](../drops/newtab-hello/drop.toml)(view は preact、言葉は Tsubaki)、
  [`drops/webpanel`](../drops/webpanel/drop.toml)(JS 無しで窓に UI を置く。二か所の root、`Ask` / `Measure`、`<browser>`、`import`)
