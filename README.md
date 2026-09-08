# noraneko-registry

noraneko の **drop**(コード一つで降ってくる機能。webext-actor の xpi)の台帳。
「誰かの判があるから入れる」ではなく、「入れる本人が中身を見られる」を一番前に置く。
ここの判は証言であって、門番ではない。

## 五段

1. **作者の repo** で build して manifest.json(xpi と source の sha256、`source: {repo, commit}`)を作り、
   keyless(sigstore)で判を押す。workflow は `templates/author-drop.yml` を repo に置くだけ。
2. **この registry** が同じ commit を同じ道具(mise: deno / ruby)で rebuild し、**同じ sha256 が出るか**確かめる。
   出たら registry の identity で判を押す(`.github/workflows/verify-and-sign.yml`)。
3. manifest の隣に **両方の判と公開リンク**(Actions の run、Rekor の logIndex)を置く(`attestations.json`)。
4. ブラウザ(noraneko)は整合性(sha256)と、**二つの判が同じ manifest に揃っているか**を確かめる。
   揃っていなければ赤で出す。止めはしない。
5. **本人が確かめる**: 権限シート、source、実際に実行されるファイル、built-in との diff、コピー、リンク。それから「入れる」。

## 置きかた

```
drops/<code>/drop.toml                       source の repo / commit / actors、作者の identity
drops/<code>/manifest.json                   作者の build が出したもの(xpi ごとの sha256)
drops/<code>/manifest.json.author.sigstore.json     作者の判(keyless bundle)
drops/<code>/manifest.json.registry.sigstore.json   registry の判(main に入ったとき workflow が押す)
drops/<code>/attestations.json               判の一覧とリンク(workflow が書く)
TRUSTED.toml                                 参考として出す identity と、揃っているべき判
trusted_root.json                            sigstore の trust root(sigstore/root-signing の pin)
```

PR は `drops/<code>/` に上の三つ(drop.toml、manifest.json、author の判)を置くだけ。
CI が作者の判を確かめ、rebuild して sha256 を比べる。通って main に入ると、registry の判が押されて
B2 の `drops/<code>/` に置かれ、`dl.f3liz.casa/drop/<code>/` で配られる。

## 手元で

```
mise install
npm install
node scripts/verify.mjs drops/<code>/manifest.json.author.sigstore.json drops/<code>/manifest.json <identity>
mise exec -- ruby scripts/rebuild.rb drops/<code>
```

- `scripts/verify.mjs`: 公式の `@sigstore/verify`(Node)。Fulcio の chain、Rekor v1/v2、TSA、SCT まで。
- `scripts/rebuild.rb`: source を clone して同じ道具で build し、sha256 を比べる。
- ブラウザの中の verifier は `@freedomofpress/sigstore-browser`(noraneko の `modules/sigstore/`)。

## 信用の根

- `TRUSTED.toml` を変えられるのは、この repo の main への PR だけ(署名必須、レビュー必須)。
- `trusted_root.json` は registry が更新して配る。ブラウザは pin を持ち、更新はブラウザの更新で届く。
- 「reproducible」は、同じ commit から Linux(CI)と手元(mac)で同じ bytes が出て初めて言える。
  ずれたら、それが最初に直す所。
