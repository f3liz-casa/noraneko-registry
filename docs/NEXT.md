# 次にやること

いま手前にあるものと、決まっていないこと。片づいたら消す。

軸: **drop の宣言と記録は、分離のためではなく「どこまで壊れるか読める」ため。**
人を信頼して、親切に。書いている最中に詰まらせない。セキュリティはサブ
(置き場所を選んだ結果として、勝手についてくる)。

---

## 1. 記録を、溜めて見せる

殻は effect のたびに一行投げている(observer `"nora-drop-did"`、`_shared/tsubakiActor.ts` の
`note`)。**いま受ける人がいない。** 投げっぱなしなので、実際には誰も見られない。

    { drop, uuid, at, did: "SetPref", about: "noraneko.hello.count", value: "1" }
    { drop, uuid, at, did: "outside", about: 'pref "…"', permission: "prefs" }

要るもの:

- 溜める場所を、本体側に一つ。actor は窓ごとに居るので、窓を跨いで溜まるところが要る
  (noraneko-testbed の `browser-features/modules/modules/` あたり)
- `about:nora:drops` の一枚に「最近したこと」:

      23:52  webpanel  設定 noraneko.webpanel.globalWidth を 400 に
      23:51  hello     ツールバーに札を置いた

  止めるためではなく分かるため。**信頼して入れるとは「見ないことにする」ではなく
  「あとで見られるから安心して入れられる」。** 監視ではなく家計簿。
- 日本語にするのは `abi/v1.json` の `ja` から(手で二度書かない)

決めていないこと:

- どれくらい残すか(drop ごとに最後の N 件? 期限? 窓を閉じたら消える?)
- profile に残すか、メモリだけか。残すなら「消す」も要る
- **値を記録に入れるか。** いまは入れている(`value`)。宣言した pref の中身なので
  見えてよいはずだけれど、記録を人に見せるものにするなら、もう一度考える

### 置いたことも残す

いま記録に出るのは effect と、宣言の外に出たこと。**「どこに置いたか」が出ない**ので、
「最近したこと」の一行目が書けない。`ctx.io.place` / `mount` のところで一行足す。

### 自分で actor.ts を書く drop にも、記録を

記録を残しているのは殻(`runTsubakiActor`)だけなので、自分で actor.ts を書いた
drop(newtab-hello、splitview)は**何をしても記録に出ない**。

その道は閉じない ── 閉じると語彙が育たない ── けれど、**何をしたかくらいは残せる**
と思う。`ctx.io` を通るもの(置いた、style を入れた、pref を見た)だけでも。
「できることが決まっていない」ことと、「何をしたかも分からない」ことは別。

## 2. 断りかたの既定を、「教える」に

いま殻は、宣言していないことを **断る**(`refuse`、15 か所)。断ったときに
drop.toml へ貼れる行は出すようにしたので、「だめ」ではなく「こう書けば通る」には
なった。**でも止まる。**

書いている最中に宣言を書き忘れて詰まる時間は、ゼロにできる ── 既定を「止めない」に
して、止めるのは registry が印を押したもの(宣言と中身が build で突き合わせ済みのもの)
だけにする。`policy.strict` のような旗を一つ足して、15 か所の呼び出しを
`if (refuse(...)) return;` の形に直す。

15 か所それぞれで「止めなかったとき何が起きるか」が違う(読む/書く/置く)ので、
一つずつ見る仕事になる。分けたのはそのため。

## 3. 宣言を、まだ言っていない drop に

`[permissions]` を書いているのは hello-tsubaki / rename-tab / shortcut-keys /
undo-closed-tab / webpanel / workspaces / zen-mode。
**まだなのは newtab / newtab-hello / splitview**(と `_example`)。

書かなくてよくなった ── 動かすと、drop.toml にそのまま貼れる行が console に出る。
`ruby scripts/lap.rb drops/<name>` で一周させて、出た行を貼る。それだけ。

## 4. style を `@scope` で包む

`setup().style` は生の一枚で、文書ぜんぶに届く。だから自分の置いたものだけを飾って
いても `chrome_style` の宣言が要る ── hello がまさにそれで、帯の見た目だけなのに
宣言している。`@scope (#<host の id>) { … }` で包めば、**宣言が要らなくなる**。

宣言は少ないほうが読める。減らせるものは減らす。

## 5. JS の drop も、同じ三つの door で

logic が Tsubaki でなくても、同じ `setup` / `start` / `dispatch` に答えられる。
容器は言語の性質ではなく走る場所の性質なので、刈った worker の中なら JS でも同じ。
実測は `~/.shiro/drops-worker-sandbox-2026-09-13.md`(一周 5 ms、刈ったあとに残る
名前は 76 個 = ECMAScript の組み込みと postMessage だけ)。

要るもの: `_shared/prune.ts`(allowlist と刈り)、`_shared/jsActor.ts`(`tsubakiActor.ts` の
兄弟)、`js-ops-worker.js`、`drop.toml` に `[actor] logic = "js"` の一言。
view の翻訳(`vnode.ts`)も effect の carry out(`perform`)もそのまま共有できる。

そして `about:nora:drops` の表示が、JS の drop でも「決まっていない」から
「この一覧が全部」に変わる。splitview も、語彙が足りれば入れる側になる。

## 6. `scripts/lap.rb` で newtab 系が起きない

実機で一周させる道具(`ruby scripts/lap.rb drops/<name>`)で、hello-tsubaki と
webpanel は置かれるのに、**newtab-hello はどの about: ページでも置かれない**
(console も静か)。本体経由では動いているので、手で `registerWindowActor` する形が
`NoraActors.sys.mts` とどこか違う。道具の穴なのか、drop の穴なのか、まだ分からない。

## 7. worker を素の `Worker` に(別の枝)

`shiro/plain-worker`。`new ChromeWorker` → `new Worker` の一行と、そのコメント。
ChromeWorker の global には `ctypes` が居て、それだけが削除も上書きもできない
(dylib を開いて呼べる)。素の Worker には居ない。wasm はどちらでも通る ── 通るのは
「worker だから」で、「ChromeWorker だから」ではなかった。

**この枝は main の前の形の上で書いたので、当て直しが要る。**
