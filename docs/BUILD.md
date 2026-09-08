# xpi ができるまで(手でなぞれる手順)

`scripts/build.rb` がやっていることを、script を読まなくても分かるように書く。
同じ commit から誰がやっても同じ bytes が出るのが約束(reproducible)。ずれたら、どこでずれたかがこの手順で分かる。

道具: `mise install`(deno 2.9.6、ruby 3.4、node 24)、`zip`(Info-ZIP 3.0。mac も ubuntu もこれ)、`git`。
依存(tsdown/rolldown、birpc、@std/path)は `tooling/webext-actors/deno.lock` で固定(integrity 込み)。`deno install --frozen` で、lock と違う bytes が来たら止まる。

## 0. 材料

```
drops/<code>/drop.toml              code / note / contact / actors
drops/<code>/src/<actor>/actor.ts   作者が書いたもの。parent(メインプロセス)と content(ページ側)の宣言
tooling/webext-actors/              build.ts、_shared/(defineActor.ts、contentRuntime.ts)、tsdown の設定、deno.json
tooling/build-drop.rb               xpi に固める(下の 3〜6)
```

## 1. 並べる(stage)

`_stage/<code>/` に `tooling/webext-actors/` の中身(`build.ts` `_shared/` `tsdown.*.config.ts` `deno.json` `tsconfig.json`)を写し、
`drops/<code>/src/<actor>/` を `_stage/<code>/<actor>/` に写す。build.ts は自分の dir の下の `_` で始まらない dir を actor と見なす。

```
mkdir -p _stage/<code>
cp -R tooling/webext-actors/{build.ts,_shared,tsdown.actor.config.ts,tsdown.content.config.ts,deno.json,deno.lock,tsconfig.json} _stage/<code>/
cp -R drops/<code>/src/<actor> _stage/<code>/<actor>
```

## 2. actor を build する(`deno task build` = `build.ts`)

`_stage/<code>/` で `mise exec -- deno install -q --frozen` のあと `mise exec -- deno task build`。actor ごとに:

1. `<actor>/actor.ts` を Deno で import して `meta`(id、version、namespace、matches、runAt)と `parent` のメソッド名を読む。
2. `_dist/<actor>/` に生成する:
   - `manifest.json`: MV2、`browser_specific_settings.gecko.id = meta.id`、`version = meta.version`、`hidden: true`、
     `permissions: ["mozillaAddons"]`、`background.scripts = ["background.js"]`、`content_scripts`(meta.matches、runAt)、
     `experiment_apis.<namespace>`(schema.json、api.js、`paths: [[namespace]]`)
   - `schema.json`: parent のメソッド名を experiment API の関数として並べたもの
   - `api.js`: `ExtensionAPI` の子。`getAPI()` が actor.mjs を `ChromeUtils.importESModule` して `parent` を返す
     (この時点では `resource://noraneko-builtin/<actor>/actor.mjs` を指す。3 で書き換わる)
   - `background.js`: `runtime.onMessage` で channel = namespace のメッセージを受け、`browser.<namespace>[method](...args)` を呼ぶ
3. tsdown を二回走らせる(`minify: false`。読める形のまま):
   - `actor.mjs`(ESM): `_gen/<actor>/parent.entry.ts` から。`parent` だけ(content と birpc は tree-shake)
   - `content.js`(IIFE): `_gen/<actor>/content.entry.ts` から。`_shared/contentRuntime.ts` と birpc を同梱

## 3. xpi の中身を整える(`build-drop.rb` の前半)

`_dist/<actor>/` の file(`actor.mjs` `api.js` `background.js` `content.js` `manifest.json` `schema.json`)を作業 dir に写し:

- `manifest.json` の `version` を `<meta.version>.<YYYYMMDDHHMM>` に。日時は **この registry の HEAD commit の時刻**(`git log -1 --format=%ct`)を UTC で分まで。
  built-in(`1.0.0`)より大きくなるので、入れたとき built-in を置き換える。`name` に `(drop <code>)` を足す。
- `api.js` の import 先を `resource://<alias>/actor.mjs` に書き換える。
  `<alias>` = `"noraneko-drop-" + code + "-" + version` を `[a-z0-9]` 以外 `-` にして小文字。
  (`importESModule` は `jar:file:` を信用しないので、入れる側(noraneko の Drops)がこの別名を xpi の root に張る)
  生成された api.js では `ChromeUtils.importESModule(` の引数が改行をまたいで書かれているので、一行の sed では当たらない。
  `ChromeUtils.importESModule(\s*"resource://noraneko-builtin/<actor>/actor.mjs",?\s*)` を丸ごと
  `ChromeUtils.importESModule("resource://<alias>/actor.mjs")` に置き換える(手でなぞって確かめた: これで build.rb と同じ bytes)。
- `source/` を足す: `<actor>/actor.ts` と `_shared/*.ts`(書いたものが xpi に同梱される。入れる本人が読む)

## 4. 確かめる(固める前)

- `.js` `.mjs` は `deno check --quiet`(parse できるか)。`.json` は `JSON.parse`。
- minify 禁止: JS の一行が 400 文字を超えていたら止める。

## 5. 固める(zip)

bytes を同じにするために:

- 全 file の権限を 644(dir は 755)、mtime を **commit の時刻を分に丸めたもの**に(`File.utime`)。
- `TZ=UTC` で、file 一覧を sort して渡す: `zip -q -X -D <code>.xpi <file...>`(`-X` 余計な属性を入れない、`-D` dir entry を入れない)。

```
cd 作業dir && TZ=UTC zip -q -X -D ../<actor>.xpi $(find . -type f | sed 's|^\./||' | sort)
```

## 6. manifest.json(drop の)

```json
{
  "code": "<code>",
  "note": "...",
  "source": { "repo": "<registry の origin>", "commit": "<HEAD 40 桁>", "commit_time": "<UTC、分に丸め>", "path": "drops/<code>/src" },
  "entries": [ { "id": "<meta.id>", "name": "<actor>", "version": "<meta.version>.<日時>", "file": "<actor>.xpi", "sha256": "...", "size": N } ]
}
```

`built_at` のような「今」は入れない(入れると commit が同じでも bytes が変わる)。

## 7. 判(main だけ、CI)

`contact`(drop.toml)を manifest に写し、`cosign sign-blob --yes --bundle manifest.json.sigstore.json manifest.json`(keyless。
identity は `https://github.com/f3liz-casa/noraneko-registry/.github/workflows/verify-and-sign.yml@refs/heads/main`)。
`attestations.json` に Rekor の logIndex と run の URL。xpi と一緒に B2 の `drops/<code>/` へ。

## 比べかた

```
mise exec -- ruby scripts/build.rb drops/<code>
shasum -a 256 _build/<code>/<actor>.xpi
```

CI の log(「registry の中で build する」の段)に同じ commit の manifest が出る。`sha256` と `version` が一致すれば、
その xpi は誰が build しても同じ。ずれるなら疑う順: (1) commit が違う(PR の merge commit は別物)、(2) 道具の版(mise.toml)、
(3) `_shared/` や tooling が違う、(4) zip の mtime / 並び / TZ。
