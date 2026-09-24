---
order: 40
description: この repo に何がどこにあるか。drop の置き場、build の産物、ブラウザが持つ情報
---

# 何がどこにあるか

registry の中で完結する。何が置かれ、何が配られるかの地図。

```
drops/<name>/drop.toml                       uuid / name / note / contact / actors(PR に要るのはこれと src/)
drops/<name>/src/<actor>/actor.ts            実際に xpi になる source
drops/<name>/manifest.json                   build の産物 + 連絡先(main で CI が書く)
drops/<name>/manifest.json.sigstore.json     registry の判(main で CI が押す)
drops/<name>/attestations.json               判とリンクの一覧(CI が書く)
tooling/                                     build の道具(noraneko から vendor。tooling/VENDORED.md に commit)
drops/std-actor/src/lib/                     drop の殻(logic の三つの door を呼んで、view を描き、effect を carry out する)。
                                             lib なので、どの drop の xpi にも入らない -- 配られるのは一枚だけ
trusted_root.json                            sigstore の trust root(sigstore/root-signing の pin)
```

## ブラウザが持つ情報

```
name     = "f3liz"
base     = "https://dl.f3liz.casa/drop"        → <base>/<uuid>/manifest.json
identity = "https://github.com/f3liz-casa/noraneko-registry/.github/workflows/verify-and-sign.yml@refs/heads/main"
issuer   = "https://token.actions.githubusercontent.com"
```

新しい drop は、registry が組み直すと一覧に載る。

自分の registry を建てるなら、この repo を fork して、`base`(配る URL)と `identity`(自分の workflow)を
ブラウザの「レジストリを足す」に書く。信用の根は、その registry の main を誰がレビューするか([TRUST](TRUST.md))。
