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
- `<browser>` も preact に作らせてよい。属性は connect の前に載る(preact は props を置いてから親が挿す)。
  ただし **`key` を必ず**: `insertBefore` は同じ位置へでもページを作り直す。std-preact-xul 1.2.0 の
  `mount()` が置いたものは `moveBefore`(取り出さない移動)で動くので、並び替えでページは消えない
  (`docs/TRAPS.md`)。手で持つやりかたも閉じてはいない。
- signals は `@preact/signals-core`。view で読むときは `useSignalValue(sig)`。
  (`@preact/signals` は preact の内部を minify 後の名前で掴むので、src から同梱した preact には掛からない)

## 置きかた

規則は一つ。**触るものは `io/`、決めるものは `.tsubaki`(か `ops/`)、あとは平らに。**

```
src/<actor>/
  main.tsubaki   決めるもの。窓も pref も知らない(純粋)
  actor.ts       入口: meta / parent / content。殻で足りるなら要らない(GUIDE の 3.5)
  io/            窓に触るところ。ここだけが増える
  view.tsx       描くところ。育ったら ui/ に割る
```

前は六つ(`types/ data/ ops/ io/ state/ ui/`)を並べていた。数えてみたら、**五つはどの drop でも
1 file しか入らなかった**(webpanel は 11 files で `io/` だけが 3、rename-tab は 9 files で `io/` が 4)。
複数あるのは副作用の種類だけで、`types/` と `data/` は分類ではなく、どこかの file に付いた注釈だった。
`state/` は「signal をどこに置くか」で、Tsubaki の殻が持つようになって消えた。

だから、名前で覚えるのはやめて、規則で覚える:

- **型**は、それを使う file の中に書く(別の file から要るようになったら、そのとき出す)。
- **定数**(pref の名前など)は、それを読む file の隣に。
- **signal** は殻の仕事。drop が持つのは、殻を使わないときだけ。
- **`io/`** だけは名前を残す。ここに入っているものが「この drop が窓に触るところ」の全部で、
  審査で読むのもここだから。

`drops/newtab` が一枚(`actor.ts` だけ)、`drops/hello-tsubaki` が JS 無し(`ops/main.tsubaki` だけ)、
`drops/webpanel` と `drops/rename-tab` は前の六層のまま(動いているので、次に触るときに寄せる)。

**増やしかたは folder ではない。** drop の力を増やすのに `io/` へ JS を書くと、drop ごとに一回ずつ
書かれて、審査する人が毎回ぜんぶ読むことになる。増やすなら **std の語彙のほう**(`SetPref` /
`OpenURL` / `Log` … `docs/GUIDE.md` の 3.5)。一回書いて一回審査されて、以後どの drop も使えて、
入れる人には「この drop に何ができるか」の一覧として見える。`io/` は、まだ語彙になっていないものの置き場。

## 設定(pref)

設定は **about:config の pref を一本ずつ**。まとめて一本の JSON にしない
(user.js で一つだけ上書きできない、他の mod から触れない、項目を足すと既に答えられている設定ごと壊れる。
cf. f3liz-casa/noraneko#127)。まとめて書ける嬉しさ — 全部が一枚に並ぶ・型が付く・補完が出る — は schema が持つ:

```ts
// data/prefs.ts   schema は定数。ここでは作らない
export const SCHEMA = { globalWidth: pref.int(400), positionStart: pref.bool(false) };
// actor.ts        窓が来てから作る(module 直下で browser に触ると build が転ぶ)
const prefs = definePrefs("noraneko.webpanel", SCHEMA);
prefs.globalWidth.value          // 読む。既定は default branch に置かれるので about:config に見える
prefs.globalWidth.set(420);      // 書く。今の値を読む必要はない
watchPrefs(ctx.io, prefs);       // 外から変わったら signal も動く(片づけは台帳に載る)
```

- `pref.bool / int / string / choice / json`(`std-prefs`)。選択肢は数ではなく名前(`choice`)。
- `pref.json` は「これは設定ではなくデータ」の印。リスト(パネルの一覧、registry の一覧)はこちら。
- 昔まとめられていた pref からは `adoptPref(leaf, "floorp.…config", "key")` で一度だけ引っ越す。相手の pref は触らない。
- 書けるのは親プロセス。content の actor(about:newtab など)は親に頼む。

`ops/` は Tsubaki で書いてもよい(`ops/*.tsubaki`、`[deps]` に `std`)。`drops/webpanel` がそう
(**actor.ts ごと Tsubaki にもできる**: `docs/GUIDE.md` の 3.5、`drops/hello-tsubaki`):

- **state はひとつの値**。`update(state, action)` が「次の state と effect たち」を返す純粋関数で、分岐は多重ディスパッチ(action ごとに一つ method)。
- **effect はデータ**。`SetPref` `OpenPopup` のような値を*作る*だけで、実際に触るのは一箇所(actor.ts を書かない drop なら殻の `perform`)。
- **view もデータ**。`view(state)` は tag / props / 子 の木を返す。`"on:command"` の値は closure ではなく **action そのもの**で、殻(`_shared/vnode.ts`)がそれを preact の listener に翻訳して、返ってきたものを `dispatch` に渡す。
- 外から来るもの(新しい uuid、今のタブの URL、実測した幅、画面の座標)は Tsubaki の中では作らない。
  **穴を埋めさせるのではなく、訊く**: `Ask(["uuid","url"], "AddPanel")` / `Measure(selector, "SetWidth")` と言うと、
  名前をつけた action になって普通の `dispatch` で返ってくる。画面の座標とページの題は `__event` に添って来る。
- **std の言葉が先に読まれている**: `get(d, :key, 既定)` / `haskey(d, :key)` / `copy(d)` / `put(d, key, value)`
  (`drops/std-tsubaki-runtime/src/ops/std.tsubaki`)。JS から来た Dict の key は文字だが、`:key` で同じものを読める。
- logic は `ctx.ops` の三つの動詞で呼ぶ(`load` / `call` / `eval`。**どれも Promise**)。実際に動いているのは drop ごとの **ChromeWorker** で、view の thread には居ない。窓に効く actor の親プロセスでは main thread で wasm が compile できないから(`docs/TRAPS.md`)。渡せるのは postMessage を越えられるもの = drop のデータそのもの。

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
- 台帳は `drops/<name>/` の三つ。中身の形は Julia の registry(General)の Versions/Deps/Compat.toml に合わせてある。sign job(`scripts/ledger.rb`)が `ledger/versions` 枝に積んで PR を一本開く(main は PR 必須)。merge すると registry がその版を知る。

  | ファイル | 何を覚える | Julia で言うと |
  |---|---|---|
  | `versions.toml` | 判が押された版: commit / time / file / sha256 と、**そのとき連れていった deps の版** | Versions.toml + Manifest |
  | `deps.toml` | その版が**誰に依存すると言っていたか**(札 = uuid) | Deps.toml |
  | `compat.toml` | その版が**どこまで許すと言っていたか**(文字列、union は配列) | Compat.toml |

  節の見出しは General では版の範囲だが、ここは一つの版だけ書く(範囲としても正しい形。まだ圧縮する理由がない)。ある版の deps / compat は「その版を含む節ぜんぶの和」で、そこも General と同じ読みかた。
- **判が押された版を、別の commit で組み直してはいけない**(build が止まる)。src を変えたら版を上げる。
- 台帳は**そのとき連れていた deps の版も覚える**(`versions.toml` の `deps = "std 1.1.0, ..."`)。src を一文字も変えなくても、
  std が上がれば配るものは変わる(deps の版は「台帳 ∪ 木」からそのとき解決されるので)。
  違っていたら build が止まる = そこも版を上げるところ。deps を覚える前の古い entry については、何も言わない。
- **選ばれた版の約束で解く。** 台帳から古い版が選ばれたら、その版の `deps.toml` / `compat.toml` で先を辿る
  (木のいまの `drop.toml` は「いまの版」の約束でしかない)。選び直しが落ち着くまで繰り返す。
- yank = `versions.toml` に `yanked = true` を書く PR。以後は選ばれないが、dl は配り続ける(固定済みの drop のため)。
- 範囲の読みかたは `scripts/compat.rb`(`ruby scripts/compat.rb --test`)。
