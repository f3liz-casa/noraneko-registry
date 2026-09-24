# noraneko-registry

[English](README.md)

noraneko の **drop**(コード一つで降ってくる機能。actor の xpi = 入れ物 + JSWindowActor、Firefox の about:newtab と同じ形)の台帳。
「誰かの判があるから入れる」ではなく、「入れる本人が中身を見られる」を一番前に置く。
ここの判は証言であって、門番ではない。

## 形

registry の中で完結する。drop の **source そのもの**がここに置かれ、build もここで行い、判もここが押す。外の repo は使わない。

1. 作者は PR に `drops/<name>/drop.toml`(uuid、name、note、連絡先、actors)と `drops/<name>/src/<actor>/actor.ts` を置く。
   PR の diff がそのまま「実際に xpi になる source」なので、レビューはそれを読む。
   正体は `uuid`(`uuidgen` で一つ振る。一度振ったら変えない)、`name` は札(dir と同じ。この registry の中で一つ)。
   Julia の General と同じ絵: 別の registry に同じ名前があっても、uuid が違えば別のもの。
2. CI が `tooling/`(noraneko から vendor した build の道具、commit を pin)で build する(reproducible)。
3. 人がレビューする(この repo の main への PR レビューが門)。
4. main に入ると、CI が build し、manifest に連絡先を写し、registry の identity で `manifest.json` に keyless の判を押して、
   xpi と一緒に `dl.f3liz.casa/drop/<uuid>` に POST する。置く側(Cloudflare Worker)がその判と xpi の sha256 と uuid を確かめてから
   B2 に書き、配るときも判が通るものだけ返す。この repo は B2 の鍵を持たない(判そのものが門)。`attestations.json` に Rekor と run のリンク。
   manifest の `source` は「この registry の、この commit の、`drops/<name>/src`」。xpi の中にも source が同梱される。
5. ブラウザ(noraneko)は **registry の一覧**を持つ(既定はこの repo。設定で足せる・外せる: iOS の代替ストアと同じ絵)。
   uuid を入れると(一覧の registry に順に訊いて、持っているところから落とす)、整合性(sha256)と「その registry の identity で押されているか」を確かめて、
   権限シート、source、実際に実行されるファイル、連絡先を見せる。合っていれば緑、違えば赤(止めない)。それから本人が「入れる」。

## 手元で

```
mise install
npm install
mise exec -- ruby scripts/dev.rb drops/<name>                   # 書いているあいだの輪(見張って、組んで、棚に置く)
mise exec -- ruby scripts/build.rb drops/<name>                 # 一度だけ組む。_build/<name>/ に xpi と manifest
node scripts/verify.mjs drops/<name>/manifest.json.sigstore.json drops/<name>/manifest.json <registry の identity>
```

- `scripts/dev.rb`: `drops/<name>/` と殻を見張って、変わったら `build.rb --dev` で組み直し、`shelf.rb` で手元の棚に置く。
  `--dev` は版に四つ目(組み直した印)を足すので、**同じ版のまま bytes だけ替わることがない**
  ── ブラウザを建て直さずに見られる。CI はこの旗を通らない(reproducible の約束はそのまま)。
- `scripts/build.rb`: `tooling/webext-actors` と `drops/<name>/src` を `_stage/` に並べて build し、`scripts/build-drop.rb` で xpi に。
  手でなぞれる手順は `docs/BUILD.md`。踏んだ穴は `docs/TRAPS.md`。**drop をはじめて作る人は `docs/GUIDE.md`**。
  置きかた(外したとき元に戻る約束)と層、依存関係と compat は `docs/LAYERS.md`。
  **drop に何を許すかの表(permission / effect / fact)は `docs/ABI.md`**。
- `scripts/verify.mjs`: 公式の `@sigstore/verify`(Node)。Fulcio の chain、Rekor v1/v2、TSA、SCT まで。
- ブラウザの中の verifier は `@freedomofpress/sigstore-browser`(noraneko の `modules/sigstore/`)。

## もっと知る

- **はじめての drop**: [GUIDE](docs/GUIDE.md) — 置く場所、最小の Tsubaki、手元で動かす、出す
- **何がどこにあるか**: [LAYOUT](docs/LAYOUT.md) — drop の置き場、build の産物、ブラウザが持つ情報
- **判と、誰が決めるか**: [TRUST](docs/TRUST.md) — 信用の根、PR の門、reproducible の約束
- **手でなぞる build**: [BUILD](docs/BUILD.md) / **層と片づけ**: [LAYERS](docs/LAYERS.md)
- **手元の棚を繋ぐ**: [SHELF](docs/SHELF.md) / **罠**: [TRAPS](docs/TRAPS.md)
