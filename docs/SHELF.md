---
order: 15
description: 手元の棚を noraneko に繋ぐ、一度だけの設定。書いているあいだの輪を閉じる
---

# 手元の棚を、ブラウザに繋ぐ(一度だけ)

[GUIDE](GUIDE.md) の輪(`dev.rb` が組み上げて、手元の棚に置く)を、ブラウザ側から
見えるようにする。drop を書くたびに要るものではないので、ここに分けてある。

noraneko 側は一度だけ:

1. pref `noraneko.drops.registries` に
   `[{"name":"local","base":"http://127.0.0.1:8765/drop","identity":"local","issuer":"local"}]`
2. `about:nora:settings#drop=<uuid>&registry=local` を開く。中身(source、実際に実行される
   file、動くページ)が出る。判は無いので「判なしでも入れる」── 手元のものに誰も判を
   押していないのは本当のことなので、それでいい。
3. pref `noraneko.drops.dev.watch` に秒数(`3` くらい)。**手元の棚だけ**を見て、版が
   動いていたら静かに入れ直す。

これで、輪が閉じる:

```text
ops/main.tsubaki を保存 → 2 秒で組み上がる → 数秒で窓の中が新しくなる
```

ブラウザを建て直す必要はない。外すのも settings から ──
**外したあと、窓に何も残っていないか**を、ときどき見てください。
