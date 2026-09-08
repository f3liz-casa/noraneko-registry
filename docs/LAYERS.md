# drop の層と、片づけの約束

drop が窓に置いたものは、drop を外したとき、その窓のまま元に戻る。
それを drop ごとに手で書かないための、置きかたの約束。

## 台帳

content hook の `ctx.onDestroy(fn)` は、actor が外れるとき(drop を外す・置き換える・窓が閉じる)に呼ばれる列。
**置いたものは、置くのと同じ息で、戻しかたをこの列に積む。** 列は置いた順の逆に走る。

その動詞が `ctx.io`(`_shared/io.ts`):

| 動詞 | 置くもの | 戻しかた |
|---|---|---|
| `io.place(node, { parent \| before \| after })` | DOM の node | `remove()` |
| `io.style(doc, css)` | `<style>` を head に | `remove()` |
| `io.listen(target, type, fn)` | event listener | `removeEventListener` |
| `io.pref(name, fn)` | pref observer | `removeObserver` |
| `io.defer(fn)` | それ以外 | `fn` そのもの |

view は `mount(ctx.io, view, { parent | before | after, tag?, id? })`(`_shared/ui.ts`):
host 要素を置いて、その中に preact で描く。戻すときは `render(null)` → host の `remove()` の順。

- **他の子がいる箱に直接 render しない。** preact は箱の中の知らない子を「余り」として消す。host を置く。
- host の tag が XUL(`vbox` など)なら中の `<hbox>` `<toolbarbutton>` も XUL、`html:div` なら中は HTML。preact は host の namespace を継ぐ。
- `<browser>` は preact に作らせない。connect の前に属性が要り、生きた状態(読み込んだページ)を持つ。
  preact が描いた箱に ref で手で入れる(`webpanel/io/browsers.ts`)。箱が消えれば一緒に消える。
- signals は `@preact/signals-core`。view で読むときは `useSignalValue(sig)`。
  (`@preact/signals` は preact の内部を minify 後の名前で掴むので、src から同梱した preact には掛からない)

## 層

`src/<actor>/` の中。要るものだけ作る(小さい drop は `actor.ts` + `ui/` で足りる)。

```
actor.ts   meta / parent / content(= init。置くのはここから)
types/     data の形
data/      定数、pref の名前
ops/       純粋な関数。list を受けて list を返す。prefs も window も触らない
io/        副作用: prefs の読み書き、<browser>、クリックが何をするか
state/     view が読む signal
ui/        preact の view(.tsx)
```

`drops/_example` が最小、`drops/webpanel` が六つ全部あるほう。

## 中に何が入るか

xpi の `content.js` には preact が **npm の src から** 同梱される(dist は minify 済で「読める形」の検査に引っかかる)。
一つの drop で 40KB ほど。`source/` には `src/<actor>/` の木がそのまま入る。
親の `actor.mjs` には `parent` だけが残る(module 直下は純粋、という contract で、副作用だけの import は落とす)。

## 依存関係と std

drop は他の drop(library drop)に依存できる。`drop.toml` に:

```toml
[deps]
std = "<std の uuid>"
```

- 札 = uuid。**版は書かない。** registry の build が、そのときの registry の木にある `drops/<dep>/drop.toml` の `version` で固定して、manifest と actor.json に写す。**組み直さない限り古いまま**(Julia の Manifest と同じ絵)。dl は `/drop/<uuid>/v/<semver>/` にその版を残す。
- **library drop** は `lib = true` + `version = "1.0.0"`。actor を持たず、`src/lib/index.ts`(→ `lib.js`。使う drop の scope に `nora_dep_<name>` を置く)か `src/wasm/`(Tsubaki の runtime → `ctx.ops`)を配る。umbrella は `[deps]` を持つ lib(`std` = `std-preact-xul` + `std-tsubaki-runtime`)。deps の deps まで平らに、依存される順に並ぶ。
- 使う側は `import { h, mount, signal, useSignalValue } from "std"`。JSX も std のもの(`jsxImportSource` は build が dep に向ける)。preact は drop に同梱されない。
- 入れるとき、deps も一緒に落として、sha と判を見て、一枚に出る。drop ごとの scope に、その drop が指した版の lib が読まれるので、二つの drop が違う版を使っても衝突しない。
- `std` が新しくなっても、使う drop は自分で組み直すまで古い std のまま。それでよい。

### compat と台帳(Julia の絵)

```toml
[deps]
std = "<uuid>"

[compat]
std = "1"          # 1.x(caret。"1.2.3" は [1.2.3, 2.0.0)、"0.2.3" は [0.2.3, 0.3.0))
# std = "~1.2"     # [1.2.0, 1.3.0)
# std = "1.2 - 1.5"  # 上を含む範囲
# std = "=1.2.3"   # その版だけ。"," で並べれば union
```

- build は「台帳(`versions.toml`、yanked を除く)∪ 木のいまの版」から、**compat を全部(umbrella の compat も)満たす最高の版**を選んで固定する。満たす版が無ければ build が止まる。compat が無ければ何でもよい。
- `drops/<name>/versions.toml` は判を押した版の台帳。sign job が `ledger/versions` 枝に積んで PR を一本開く(main は PR 必須)。merge すると registry がその版を知る。
- **判が押された版を、別の commit で組み直してはいけない**(build が止まる)。src を変えたら版を上げる。
- yank = `versions.toml` に `yanked = true` を書く PR。以後は選ばれないが、dl は配り続ける(固定済みの drop のため)。
- 範囲の読みかたは `scripts/compat.rb`(`ruby scripts/compat.rb --test`)。
