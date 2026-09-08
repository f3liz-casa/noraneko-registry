# noraneko-registry

noraneko の **drop**(コード一つで降ってくる機能。webext-actor の xpi)の台帳。
「誰かの判があるから入れる」ではなく、「入れる本人が中身を見られる」を一番前に置く。
ここの判は証言であって、門番ではない。

## 形

判は **registry のもの一つ**。作者は判を押さない。代わりに連絡先(`contact = "gh/<username>"`)を書く。

1. 作者は PR に `drops/<code>/drop.toml`(source の repo / commit / actors、連絡先)を置く。
2. registry の CI が同じ commit を同じ道具(mise: deno / ruby)で rebuild する(reproducible)。
3. 人がレビューする(source を読む。この repo の main への PR レビューが門)。
4. main に入ると、CI が manifest に連絡先を写し、registry の identity で `manifest.json` に keyless の判を押して、xpi と一緒に B2 の `drops/<code>/` に置く(`dl.f3liz.casa/drop/<code>/`)。`attestations.json` に Rekor と run のリンク。
5. ブラウザ(noraneko)は **registry の一覧**を持つ(既定はこの repo。設定で足せる・外せる: iOS の代替ストアと同じ絵)。
   選んだ registry のコードを入れると、整合性(sha256)と「その registry の identity で押されているか」を確かめて、
   権限シート、source、実際に実行されるファイルを見せる。合っていれば緑、違えば赤(止めない)。それから本人が「入れる」。

## 置きかた

```
drops/<code>/drop.toml                       source の repo / commit / actors、連絡先(PR に要るのはこれだけ)
drops/<code>/manifest.json                   rebuild の産物 + 連絡先(main で CI が書く)
drops/<code>/manifest.json.sigstore.json     registry の判(main で CI が押す)
drops/<code>/attestations.json               判とリンクの一覧(CI が書く)
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
node scripts/verify.mjs drops/<code>/manifest.json.sigstore.json drops/<code>/manifest.json <registry の identity>
mise exec -- ruby scripts/rebuild.rb drops/<code>
```

- `scripts/verify.mjs`: 公式の `@sigstore/verify`(Node)。Fulcio の chain、Rekor v1/v2、TSA、SCT まで。
- `scripts/rebuild.rb`: source を clone して同じ道具で build し、sha256 を比べる。
- ブラウザの中の verifier は `@freedomofpress/sigstore-browser`(noraneko の `modules/sigstore/`)。

## 信用の根

静的な「信用する identity の一覧」は持たない。判の「誰か」は `drop.toml` に書いてあるそのままで、
それを読んで通すかどうかは、**この repo の main への PR レビュー**で人が決める。

- main は直 push 不可。PR 必須、コミット署名必須、CI(作者の判 + rebuild)が緑であること。
- ブラウザが見せるのは「作者の判(drop.toml の identity)と registry の判が同じ manifest に揃っているか」だけ。
  誰を信じるかは、入れる本人。
- `trusted_root.json` は registry が更新して配る。ブラウザは pin を持ち、更新はブラウザの更新で届く。
- 「reproducible」は、同じ commit から Linux(CI)と手元(mac)で同じ bytes が出て初めて言える。
  ずれたら、それが最初に直す所。
