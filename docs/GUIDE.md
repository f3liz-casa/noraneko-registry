# drop を作る(はじめての人へ)

drop は、noraneko に **コード一つで降ってくる機能**。中身は小さな xpi(入れ物)と JSWindowActor(ページや窓への道)で、
Firefox 自身の about:newtab と同じ形。書くのは `actor.ts` **一枚**だけ。build も判も、この registry がやる。

いちばん前に置いているのは「入れる本人が中身を読める」こと。だから、読める形で書く(minify 無し、一枚、依存を持ち込まない)。
PR の diff がそのまま「実際に xpi になる source」で、レビューはそれを読む。

## 1. 置く場所

```
drops/<name>/drop.toml               uuid / name / note / contact / actors
drops/<name>/src/<actor>/actor.ts    書くのはこれ(actor はいくつでも)
```

`drop.toml` は `drops/_example/drop.toml` を写す。

```toml
uuid = "..."                # uuidgen | tr A-Z a-z で一つ振る。一度振ったら変えない(正体)
name = "hello"              # dir と同じ。この registry の中で一つ(札)
note = "何をする drop か、一行で"
contact = ["gh/you"]        # 困ったとき、誰に訊けばいいか(gh/ mail/ social/)
actors = ["hello"]          # src/<actor>/actor.ts
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
- **一枚に書く。** `_shared/` は tooling のもので、drop から足せない。CSS も文字列で持つ。JSX は無い(`document.createElement` / `createXULElement` で組む)。
- **読める形で。** build は minify しないし、一行 400 字を超える JS があれば断る。依存を持ち込むなら、その source を自分の一枚に写す(vendored で見える形)。
- **短く。** DOM を触るのは JS で間違いないけれど、JS の分量は最小に。大きい logic は将来 WASM(`.tsubaki`)に分ける絵。

`ctx` にあるもの:

- `ctx.expose({ fn })` — ページの `window` に関数を生やす(exportFunction)。
- `ctx.onDestroy(fn)` — この actor が外れるとき(drop を外した・置き換えた)に呼ばれる。**置いたものは、ここで戻す。**
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
- 置いたもの(DOM、style、observer、listener)は **`ctx.onDestroy` で全部戻す**。外したあとに残るのは、いちばん嫌なこと。
- 入れる人の画面には「ブラウザの窓そのものに効く」と出る。渡す力が大きいぶん、レビューも重い。

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
- 実物: `drops/newtab`(小さい)、`drops/webpanel`(窓に UI を置く、片づけつき)
