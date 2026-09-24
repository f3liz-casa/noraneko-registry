# ABI(drop が何をできるかの、ただ一つの表)

`abi/v1.json` がその表。drop に許していることの全部が、ここに一枚で並んでいる。
**この一枚から四人が読む**、と表の頭にも書いてある:

- **殻**(`drops/std-actor/src/lib/`)── 実行時に断る。宣言していない effect は carry out しない
  (`refuse`)、宣言していない pref は読めない、知らない tag は描かない。
- **build**(`tooling/webext-actors/build.ts`)── 組むところで読み、`actor.json` の
  `permissions` を書き、`check-drop.rb` が「宣言」と「実際にしたこと」を突き合わせる。
- **店の画面**── 入れる人に見せる日本語の一行が、`ja` に入っている。drop ごとの行は
  build が `grantsOf()` で組み立てる(`{names}` に、宣言した名前を差し込んで)。
- **docs**── この file と `docs/GUIDE.md`。

四人が別々に一覧を持ったら、いつか必ずずれる。ずれた一覧は、入れる人に「これ以外の
ことはできません」と言いながら、実際にはできる、という形でずれる。だから**表は一枚だけ**で、
あとの三人はここから読む。増やすのは `v1.json` の一行と、それを読む四人の側。

---

## 表の中身

### permissions ── 何を許すか

入れる人の画面に出るのはこれだけ。drop.toml の `[permissions]` に書く。形は三つ:

| shape | 書きかた | 例 | 画面 |
|---|---|---|---|
| `flag` | `clipboard_read = true` | ひとつを許す / 許さない | `ja` がそのまま出る |
| `names` | `prefs = ["…", "…"]` | 名指ししたものだけ。`ja` の `{names}` に並ぶ | 名前を表の日本語に直して出る |
| `level` | `tabs = "read"` / `files = "open"` | 段。**並んでいる順に強い** | その段の一文だけ出る |

自分の名前空間(`noraneko.<drop の名前>.*`)の pref だけは、名指しが要らない
(`manifest.json` の `ownPrefix`)。それ以外の pref は一つずつ名指しする。

段があるのは、いま `tabs`(read / write)と `files`(read / open)。段は**一つずつ**増やす
── 上の段を書けば下の段の一文も、その中に含まれる。

### effects ── 殻が carry out すること

logic が `[SetPref(…), OpenURL(…)]` のように Effect の値を*作る*だけで、実際に触るのは
殻の `perform` 一箇所(`drops/std-actor/src/lib/tsubakiActor.ts`)。effect は三つ組を持つ:

```
"SetPref": { "args": ["name", "value"], "permission": "prefs", "ja": "設定を書く" }
```

- `permission` が `null` の effect は、誰でも使える(`Ask` / `Measure` / `OpenPopup` / `Log`)。
- 段のある permission を要る effect は、`level` も書く(`{"permission":"files","level":"open"}`)。
  `check-drop.rb` が、その `level` を読んで「段が足りない」と言う ── この名前を
  check-drop に写し直さない、がここで守られている。
- effect を一つ足す = Tsubaki の言葉(`std-tsubaki-runtime` の `ops/std.tsubaki`)も一つ足す。

### facts ── logic が「訊く」こと

logic は事実を作らない(新しい uuid も、いま見ているタブの URL も、実測した幅も、
worker の中では分からない)。だから action に穴を開けて埋めさせず、**訊いて、名前を
つけた action で返してもらう**(`Ask(fields, action)`)。事実そのものに permission が
付くことがある(`url` は `current_url`、`clipboard` は `clipboard_read`)。付いて
いなければ誰でも訊ける(`uuid` / `session_start`)。

### そのほか、表が持っているもの

permission / effect / fact のほかに、**動かない一覧**がある。drop が名前で書いて、
殻か build が実物に直す:

- `tags` ── view が名乗れる要素。inert なものだけ(何も読み込まない、何も走らせない)
- `props` ── view が書ける属性。`url_valued` は scheme を絞る
- `commands` / `browser_pages` / `menus` / `tab_events` / `toolbar_areas` / `key_combo`
  ── ブラウザ側の名前。drop は `chrome://` の綴りも、命令の実装名も一度も書かない

---

## 二つの門

effect が実際に走るには、**二つとも**要る:

1. **表に有る** ── 殻が名前を知っている(`abi/v1.json` と `perform` の switch)。
2. **宣言に有る** ── drop.toml の `[permissions]` に、その行がある。

片方でも欠けたらしない。綴りを間違えても、ブラウザの知らない口は開かない。逆に、
宣言だけして使わない行があれば、`check-drop.rb` が「使っていない」と言う ── 入れる人の
画面の行が、年月とともにただ伸びるのを防ぐ。**組むところで止まる**のは、実機の console で
気づくのが「出したあと」だから。

---

## 言葉を一つ足すとき

1. `abi/v1.json` に permission(と、要るなら effect / fact)を書く。`ja` は入れる人に
   そのまま出る一文なので、**何を許すのか**が読んで分かる言葉で。
2. `tooling/webext-actors/build.ts` の `permissionsOf()` に、その permission を
   `ViewPolicy` へ写す一行を足す。
3. `drops/std-actor/src/lib/vnode.ts` の `ViewPolicy` に欄を足す。
4. 殻に実装を足す ── `perform` に case、事実なら `factOf`、`Ask` に宣言の門。
   断りかたは「だめ」ではなく**「こう書けば通る」**(そのまま drop.toml に貼れる行)。
5. `drops/std-tsubaki-runtime/src/ops/std.tsubaki` に、Tsubaki から書く言葉(struct)。
6. `scripts/check-drop.rb` に、その effect / fact を数える一行(段のある effect は
   `level` から自動で拾われるので、要らないことが多い)。
7. 表を読む四人がまだ合っているか、試験で確かめる:

```
cd tooling/webext-actors
mise exec -- deno test --no-check --allow-read --config deno.test.json test/
```

`test/abi_test.ts` が門番をしている ── effect が名指しする permission は表に有るか、
段のある permission は段ごとに日本語があるか、段を名指しする effect は本当にその段を
言っているか、`names` の `ja` に `{place}` があるか。「増やすのは一つずつ」は、この
試験が「まだ無い段を先に載せた」を見つける形にもなっている。

増やすなら **std の語彙のほうへ**(`docs/LAYERS.md`)。drop ごとの `io/` に JS を書くと、
審査する人が drop の数だけ同じことを読む。一度ここに書けば、審査は一度で、以後どの
drop も同じ言葉を使えるし、入れる人には「この drop に何ができるか」の一覧として見える。

---

## sandbox の印

`actor.json` の `sandbox` は、build が押す印で、条件は三つ(`build.ts` の `stampOf`):
殻を着せた actor であること、親で呼べる関数が一つも無いこと、dep が殻として読まれる
lib / wasm だけであること。この三つが揃ったときだけ、店の画面の「これ以外のことは
できません」が**硬い約束**になる ── drop が書いた JS が一行も走らず、logic は worker の
中の命令列だけだから。

`actor.ts` を書いた drop には印を押さない。押さないのは、その drop が effect の一覧の
外のこともできるから ── 隔離ではなく**正直さ**で守る層(「サンドボックス」と「コードを
読む」は別の約束)。印の意味と、std を誰が触れるかは `docs/LAYERS.md` と `docs/TRAPS.md`。

---

## 版

表の頭の `"abi": "1.0"` が、その版。`actor.json` にも `abi` として写るので、入れる人の
画面と、drop が組まれた時の表が、どの版だったかを言える。表に一行足すのは、**入れる
人の画面を変える**ことでもある(新しい行が出る / 段の一文が変わる)。だから effect と
permission と `ja` は、一つの PR の中で揃えて動かす。
