---
order: 50
description: 判と、誰が決めるか。信用の根、PR の門、reproducible の約束
---

# 信用の根(判と、誰が決めるか)

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
