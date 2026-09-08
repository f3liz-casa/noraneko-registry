# noraneko-registry

noraneko の **drop**(コード一つで降ってくる機能。actor の xpi = 入れ物 + JSWindowActor、Firefox の about:newtab と同じ形)の台帳。
「誰かの判があるから入れる」ではなく、「入れる本人が中身を見られる」を一番前に置く。
ここの判は証言であって、門番ではない。

## 形

registry の中で完結する。drop の **source そのもの**がここに置かれ、build もここで行い、判もここが押す。外の repo は使わない。

1. 作者は PR に `drops/@<namespace>/<name>/drop.toml`(name、note、連絡先、actors)と `drops/@…/<name>/src/<actor>/actor.ts` を置く。
   名前は `@<namespace>/<name>`(npm の scope と同じ絵。namespace はこの registry の名前 `f3liz`)。
   noraneko に入れる字と、配る URL(`dl.f3liz.casa/drop/@f3liz/<name>/`)と、この dir が、同じ字で 1:1。
   PR の diff がそのまま「実際に xpi になる source」なので、レビューはそれを読む。
2. CI が `tooling/`(noraneko から vendor した build の道具、commit を pin)で build する(reproducible)。
3. 人がレビューする(この repo の main への PR レビューが門)。
4. main に入ると、CI が build し、manifest に連絡先を写し、registry の identity で `manifest.json` に keyless の判を押して、
   xpi と一緒に `dl.f3liz.casa/drop/@<namespace>/<name>` に POST する。置く側(Cloudflare Worker)がその判と xpi の sha256 を確かめてから
   B2 に書き、配るときも判が通るものだけ返す。この repo は B2 の鍵を持たない(判そのものが門)。`attestations.json` に Rekor と run のリンク。
   manifest の `source` は「この registry の、この commit の、`drops/@…/<name>/src`」。xpi の中にも source が同梱される。
5. ブラウザ(noraneko)は **registry の一覧**を持つ(既定はこの repo。設定で足せる・外せる: iOS の代替ストアと同じ絵)。
   `@<namespace>/<name>` を入れると、整合性(sha256)と「その registry の identity で押されているか」を確かめて、
   権限シート、source、実際に実行されるファイル、連絡先を見せる。合っていれば緑、違えば赤(止めない)。それから本人が「入れる」。

## 置きかた

```
drops/@f3liz/<name>/drop.toml                       name / note / contact / actors(PR に要るのはこれと src/)
drops/@f3liz/<name>/src/<actor>/actor.ts            実際に xpi になる source
drops/@f3liz/<name>/manifest.json                   build の産物 + 連絡先(main で CI が書く)
drops/@f3liz/<name>/manifest.json.sigstore.json     registry の判(main で CI が押す)
drops/@f3liz/<name>/attestations.json               判とリンクの一覧(CI が書く)
tooling/                                     build の道具(noraneko から vendor。tooling/VENDORED.md に commit)
trusted_root.json                            sigstore の trust root(sigstore/root-signing の pin)
```

ブラウザが持つこの registry の情報:

```
name     = "f3liz"
base     = "https://dl.f3liz.casa/drop"
identity = "https://github.com/f3liz-casa/noraneko-registry/.github/workflows/verify-and-sign.yml@refs/heads/main"
issuer   = "https://token.actions.githubusercontent.com"
```

自分の registry を建てるなら、この repo を fork して、`base`(配る URL)と `identity`(自分の workflow)を
ブラウザの「レジストリを足す」に書く。信用の根は、その registry の main を誰がレビューするか。

## 手元で

```
mise install
npm install
mise exec -- ruby scripts/build.rb drops/@f3liz/<name>          # _build/@f3liz/<name>/ に xpi と manifest
node scripts/verify.mjs drops/@f3liz/<name>/manifest.json.sigstore.json drops/@f3liz/<name>/manifest.json <registry の identity>
```

- `scripts/build.rb`: `tooling/webext-actors` と `drops/@…/<name>/src` を `_stage/` に並べて build し、`scripts/build-drop.rb` で xpi に。
  手でなぞれる手順は `docs/BUILD.md`。踏んだ穴は `docs/TRAPS.md`。
- `scripts/verify.mjs`: 公式の `@sigstore/verify`(Node)。Fulcio の chain、Rekor v1/v2、TSA、SCT まで。
- ブラウザの中の verifier は `@freedomofpress/sigstore-browser`(noraneko の `modules/sigstore/`)。

## 信用の根

静的な「信用する identity の一覧」は持たない。判の「誰か」は `drop.toml` に書いてあるそのままで、
それを読んで通すかどうかは、**この repo の main への PR レビュー**で人が決める。

- main は直 push 不可。PR 必須、コミット署名必須、CI(build)が緑であること。
- 判を押す job は environment `registry`(required reviewer = 管理者)。main に入っても、管理者が承認するまで判は押されない。
  PR の中では id-token が無いので判は押せない。fork からの PR は毎回 承認が要る。
- ブラウザが見せるのは「作者の判(drop.toml の identity)と registry の判が同じ manifest に揃っているか」だけ。
  誰を信じるかは、入れる本人。
- `trusted_root.json` は registry が更新して配る。ブラウザは pin を持ち、更新はブラウザの更新で届く。
- 「reproducible」は、同じ commit から Linux(CI)と手元(mac)で同じ bytes が出て初めて言える。
  ずれたら、それが最初に直す所。
