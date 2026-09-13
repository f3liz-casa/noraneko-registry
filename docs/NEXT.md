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
    { drop, uuid, at, did: "outside", about: "…", permission: "chrome_style", stopped: false }

要るもの:

- 溜める場所を、本体側に一つ。actor は窓ごとに居るので、窓を跨いで溜まるところが要る
  (noraneko-testbed の `browser-features/modules/modules/` あたり)
- `about:nora:drops` の一枚に「最近したこと」:

      15:52  hello   設定 noraneko.hello.count を 1 に
      15:51  hello   ツールバーに札を置いた

  止めるためではなく分かるため。**信頼して入れるとは「見ないことにする」ではなく
  「あとで見られるから安心して入れられる」。** 監視ではなく家計簿。
- 日本語にするのは `abi/v1.json` の `ja` から(手で二度書かない)

決めていないこと:

- どれくらい残すか(drop ごとに最後の N 件? 期限? 窓を閉じたら消える?)
- profile に残すか、メモリだけか。残すなら「消す」も要る
- **値を記録に入れるか。** いまは入れている(`value`)。宣言した pref の中身なので
  見えてよいはずだけれど、記録を人に見せるものにするなら、もう一度考える

### 自分で actor.ts を書く drop にも、記録を

いま記録を残しているのは殻(`runTsubakiActor`)だけなので、自分で actor.ts を書いた
drop(newtab-hello、rename-tab)は**何をしても記録に出ない**。

その道は閉じない ── 閉じると語彙が育たない ── けれど、**何をしたかくらいは残せる**
と思う。`ctx.io` を通るもの(置いた、style を入れた、pref を見た)だけでも。
「できることが決まっていない」ことと、「何をしたかも分からない」ことは別。

## 2. 宣言を、まだ言っていない drop に

`[permissions]` を書いているのは hello-tsubaki だけ。webpanel / newtab-hello /
splitview / rename-tab はまだ。

**書かなくてよくなった** ── 動かすと、drop.toml にそのまま貼れる行が console に出る。
一周させて、出た行を貼る。それだけ。

## 3. `strict` の印

宣言の外に出たとき、いまは**どこからも止めていない**(`policy.strict` を true にする
ところが無い)。止めるのは registry が判を押したもの ── 宣言と中身が build で
突き合わせ済みのもの ── だけにしたい。`actor.json` の印(`25a145b`)から立てる。

手元で書いているあいだは、ずっと「教える」のまま。そこは変えない。

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
「この一覧が全部」に変わる。rename-tab も、語彙が足りれば入れる側になる。

## 6. `scripts/lap.rb` で newtab 系が起きない

実機で一周させる道具(`ruby scripts/lap.rb drops/<name>`)で、hello-tsubaki と
webpanel は置かれるのに、**newtab-hello はどの about: ページでも置かれない**
(console も静か)。本体経由では動いているので、手で `registerWindowActor` する形が
`NoraActors.sys.mts` とどこか違う。道具の穴なのか、drop の穴なのか、まだ分からない。

## 7. worker を素の `Worker` に(別の枝)

`shiro/plain-worker`(`5d0a6dd`、まだ push していない)。`new ChromeWorker` →
`new Worker` の一行と、そのコメント。ChromeWorker の global には `ctypes` が居て、
それだけが削除も上書きもできない(dylib を開いて呼べる)。素の Worker には居ない。
wasm はどちらでも通る ── 通るのは「worker だから」で、「ChromeWorker だから」ではなかった。

この枝と混ぜていないので、どちらから入れてもいい。
