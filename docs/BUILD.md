# xpi ができるまで(手でなぞれる手順)

`scripts/build.rb` がやっていることを、script を読まなくても分かるように書く。
同じ commit から誰がやっても同じ bytes が出るのが約束(reproducible)。ずれたら、どこでずれたかがこの手順で分かる。

道具: `mise install`(deno 2.9.6、ruby 3.4、node 24)、`zip`(Info-ZIP 3.0。mac も ubuntu もこれ)、`git`。
依存(tsdown/rolldown、birpc、@std/path)は `tooling/webext-actors/deno.lock` で固定(integrity 込み)。`deno install --frozen` で、lock と違う bytes が来たら止まる。

## 0. 材料

```
drops/@f3liz/<name>/drop.toml       name(@<namespace>/<name>)/ note / contact / actors
drops/@f3liz/<name>/src/<actor>/actor.ts   作者が書いたもの。parent(メインプロセス)と content(ページ側)の宣言
tooling/webext-actors/              build.ts、_shared/(defineActor.ts、contentRuntime.ts)、tsdown の設定、deno.json
scripts/build-drop.rb               xpi に固める(下の 3〜6。noraneko の testbed と同じ script)
```

## 1. 並べる(stage)

`_stage/<namespace>-<name>/` に `tooling/webext-actors/` の中身(`build.ts` `_shared/` `tsdown.*.config.ts` `deno.json` `tsconfig.json`)を写し、
`drops/@<namespace>/<name>/src/<actor>/` を `_stage/<namespace>-<name>/<actor>/` に写す。build.ts は自分の dir の下の `_` で始まらない dir を actor と見なす。

```
mkdir -p _stage/<namespace>-<name>
cp -R tooling/webext-actors/{build.ts,_shared,tsdown.actor.config.ts,tsdown.content.config.ts,deno.json,deno.lock,tsconfig.json} _stage/<namespace>-<name>/
cp -R drops/@<namespace>/<name>/src/<actor> _stage/<namespace>-<name>/<actor>
```

## 2. actor を build する(`deno task build` = `build.ts`)

`_stage/<namespace>-<name>/` で `mise exec -- deno install -q --frozen` のあと `mise exec -- deno task build`。actor ごとに:

1. `<actor>/actor.ts` を Deno で import して `meta`(id、version、namespace、matches、runAt)と `parent` のメソッド名を読む。
2. `_dist/<actor>/` に生成する(Firefox 自身の about:newtab add-on と同じ形。xpi は入れ物、ページへの道は JSWindowActor):
   - `manifest.json`: MV2、`browser_specific_settings.gecko.id = meta.id`、`version = meta.version`、`hidden: true`。それだけ
     (content_scripts も experiment_apis も background も無い。stock Firefox では about:* に content script が入らないため。
     noraneko の `webext-actors/README.md`「addon 式が駄目だった理由」)
   - `actor.json`: JSWindowActor の登録に要るもの。`name`(`Nora` + PascalCase(actor)、例 NoraNewtab)、`id`、`version`、
     `matches`(meta.matches)、`event`(runAt から: document_start → DOMDocElementInserted、document_end → DOMContentLoaded、
     document_idle → load)、`methods`(parent のメソッド名)、`replaces`、`includeParent: true`、`safeForUntrustedWebProcess`(web の match があるとき)
   - `parent.sys.mjs`: `class <name>Parent extends JSWindowActorParent`。`receiveMessage` で actor.mjs の `parent[method](...args)`
     (この時点では `resource://noraneko-builtin/<actor>/actor.mjs` を指す。3 で書き換わる)
   - `child.sys.mjs`: `class <name>Child extends JSWindowActorChild`。`event` で content.js を `loadSubScript` で読む
     (`window` / `document` / `exportFunction` / `__nora` を scope に載せる。`__nora.call` が `sendQuery`)
3. tsdown を二回走らせる(`minify: false`。読める形のまま):
   - `actor.mjs`(ESM): `_gen/<actor>/parent.entry.ts` から。`parent` だけ(content と birpc は tree-shake)
   - `content.js`(IIFE): `_gen/<actor>/content.entry.ts` から。`_shared/contentRuntime.ts` と birpc を同梱

## 3. xpi の中身を整える(`build-drop.rb` の前半)

`_dist/<actor>/` の file(`actor.json` `actor.mjs` `child.sys.mjs` `content.js` `manifest.json` `parent.sys.mjs`)を作業 dir に写し:

- `manifest.json` の `version` を `<meta.version>.<YYYYMMDDHHMM>` に。日時は **この registry の HEAD commit の時刻**(`git log -1 --format=%ct`)を UTC で分まで。
  built-in(`1.0.0`)より大きくなるので、入れたとき built-in を置き換える。`name` に `(drop @<namespace>/<name>)` を足す。
- `parent.sys.mjs` と `child.sys.mjs` の中の `resource://noraneko-builtin/<actor>/` を全部 `resource://<alias>/` に書き換える。
  `<alias>` = `"noraneko-drop-" + (name の頭の @ を落としたもの) + "-" + version` を `[a-z0-9]` 以外 `-` にして小文字
  (例: `@f3liz/newtab` 1.0.0.202609080512 → `noraneko-drop-f3liz-newtab-1-0-0-202609080512`)。
  (`importESModule` は `jar:file:` を信用しないので、入れる側(noraneko の Drops)がこの別名を xpi の root に張る)
  `sed 's|resource://noraneko-builtin/[^/"]*/|resource://<alias>/|g'` で当たる(どちらの file も一行に収まっている)。
- `source/` を足す: `<actor>/actor.ts` と `_shared/*.ts`(書いたものが xpi に同梱される。入れる本人が読む)

## 4. 確かめる(固める前)

- `.js` `.mjs` は `deno check --quiet`(parse できるか)。`.json` は `JSON.parse`。
- minify 禁止: JS の一行が 400 文字を超えていたら止める。

## 5. 固める(zip)

bytes を同じにするために:

- 全 file の権限を 644(dir は 755)、mtime を **commit の時刻を分に丸めたもの**に(`File.utime`)。
- `TZ=UTC` で、file 一覧を sort して渡す: `zip -q -X -D <actor>.xpi <file...>`(`-X` 余計な属性を入れない、`-D` dir entry を入れない)。

```
cd 作業dir && TZ=UTC zip -q -X -D ../<actor>.xpi $(find . -type f | sed 's|^\./||' | sort)
```

## 6. manifest.json(drop の)

```json
{
  "name": "@<namespace>/<name>",
  "note": "...",
  "source": { "repo": "<registry の origin>", "commit": "<HEAD 40 桁>", "commit_time": "<UTC、分に丸め>", "path": "drops/@<namespace>/<name>/src" },
  "entries": [ { "id": "<meta.id>", "name": "<actor>", "version": "<meta.version>.<日時>", "file": "<actor>.xpi", "sha256": "...", "size": N } ]
}
```

`built_at` のような「今」は入れない(入れると commit が同じでも bytes が変わる)。

## 7. 判(main だけ、CI)

`contact`(drop.toml)を manifest に写し、`cosign sign-blob --yes --bundle manifest.json.sigstore.json manifest.json`(keyless。
identity は `https://github.com/f3liz-casa/noraneko-registry/.github/workflows/verify-and-sign.yml@refs/heads/main`)。
`attestations.json` に Rekor の logIndex と run の URL。xpi と一緒に `dl.f3liz.casa/drop/@<namespace>/<name>` へ POST。

## 比べかた

```
mise exec -- ruby scripts/build.rb drops/@f3liz/<name>
shasum -a 256 _build/@f3liz/<name>/<actor>.xpi
```

CI の log(「registry の中で build する」の段)に同じ commit の manifest が出る。`sha256` と `version` が一致すれば、
その xpi は誰が build しても同じ。ずれるなら疑う順: (1) commit が違う(PR の merge commit は別物)、(2) 道具の版(mise.toml)、
(3) `_shared/` や tooling が違う、(4) zip の mtime / 並び / TZ。
