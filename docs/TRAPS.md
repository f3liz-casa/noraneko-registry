# 罠(踏んだもの、踏みそうなもの)

作りながら実際に踏んだ穴と、いまどう避けているか。新しく踏んだら足す。
「なぜそうなっているか」が分からなくなったとき、ここを読む。

## ページ側

### about:* / chrome:* には WebExtension の content script が入らない(stock Firefox)

一番大きかった罠。最初の drop は「特権 built-in WebExtension + content_scripts + experiment API」で、
about:newtab に一行も届かなかった。built-in の newtab actor も同じで、誰も気づいていなかった
(ページのデータは古い JSActor が運んでいたので、動いて見えていた)。
`mozillaAddons` で privileged にしても、host permission に `about:newtab*` を足しても入らない。
`https://example.com/*` を matches に足すとそこでは走る(= about: だけが閉じている)。

いま: Mozilla 自身の about:newtab add-on と同じ形。xpi は入れ物(manifest は id / version / hidden だけ)、
ページへの道は JSWindowActor(`actor.json` + `parent.sys.mjs` + `child.sys.mjs`)。
子が `content.js` を `loadSubScript` で `window` / `document` 付きの scope に読むので、drop の書きかたは変わらない。
noraneko の `webext-actors/README.md`「addon 式が駄目だった理由」にも同じことが書いてある。

### 入れ替えた bytes が、その session から見えない(版が同じときだけ)

**版が変われば、いまは見える。** 手元の置き場に版が入るようになった(noraneko `3691c27`):

    <profile>/noraneko-drops/<uuid>/<版>/<drop>.xpi
    <profile>/noraneko-drops/<uuid>/deps/<名前>/<版>/lib.xpi

前はどの版も同じ file 名に上書きしていたので、その session で前の版が一度でも開かれていると
jar の handle が生きていて、**新しい別名が前の bytes を指した**。二度踏んだ:
2026-09-08 は runtime 0.4.0 を入れたのに 0.3.0 の wasm が動き、2026-09-09 は webpanel 1.3.0 に
std 1.1.0 の lib.js が読まれて `std.pref is undefined`。どちらも立て直すまで分からなかった。

**残っているのは、版が同じまま中身だけ変えたとき**(手元で組み直したときだけ起きる。registry は
判を押した版の bytes を変えさせない)。そのときは版を上げるか、ブラウザを立て直してから見る。

### 古い形の xpi は、新しい noraneko に入らない

`actor.json` が無い xpi は `NoraActors.readActorJson` で落ちる。逆(新しい xpi を古い noraneko に)は、
content script が about: に入らないので、入るけど何も起きない。
道具(tooling/)を替えたら、配っている drop を全部 `workflow_dispatch` で置き直す。

### `resource://` の先が `jar:file:` だと `fetch()` は NetworkError

xpi の中の `actor.json` を `fetch("resource://<alias>/actor.json")` で読もうとして落ちた。
`NetUtil.asyncFetch({ uri, loadUsingSystemPrincipal: true })` なら読める。`importESModule` と `loadSubScript` は平気。

### `importESModule` は `jar:file:` を信用しない

"System modules must be loaded from a trusted scheme"。だから入れる側が `resource://noraneko-drop-<uuid>-<版>/` を
xpi の root に張り、xpi の中の `parent.sys.mjs` / `child.sys.mjs` はその URL を指す(build-drop.rb が書き換える)。
`setSubstitutionWithFlags(..., ALLOW_CONTENT_ACCESS)` で。content process にも同じ別名が届く。

### 別名に版を入れる理由(と、そこに残っている穴)

module cache は URL 単位。同じ session で drop の版を替えたとき、別名が同じだと古い module が残る。
だから `noraneko-drop-<uuid>-<版>`。

**版が同じで中身だけ違うときは、まだ効かない。** 2026-09-08 まで版には commit の時刻が四つ目として
付いていた(`1.2.0.202609081330`)が、あれも commit ごとにしか変わらないので、**commit せずに組み直す
夜の輪では最初から同じ**だった。しかも WebExtension の版は一つが 9 桁までで、12 桁の時刻は毎回
Firefox に警告されていた。なので外した(`scripts/build-drop.rb`)。

いまの約束は「中身が変われば版を上げる」(台帳の門)。配ったものについてはそれで足りる。
残るのは手元の輪だけ — 同じ版のまま組み直して入れ直したら、その session では古い module が動きうる。
気になるなら noraneko 側(`Drops.sys.mts` の `resAlias`)で xpi の sha を別名に足すのが素直。

### about:newtab は先読みされている

Firefox は次の新しいタブを裏で先に作っておく。drop を入れた直後の一枚は、入れる前に作られたもののことがある。
「入れたのに出ない」は、もう一枚開いてから判断する。

### 「動いた」の根拠を取り違える

marker9 のとき「[drop-marker] getData is running from the DROP」が出て安心したが、それを呼んでいたのは
background.js(親側)で、content script ではなかった。親が動く証拠と、ページに届いた証拠は別。
ページに届いたかは、ページの DOM に印を付けて、ページの中から読む(BiDi、下)。

## Tsubaki(ops/*.tsubaki)

### 親プロセスの main thread では wasm が compile できない(worker の中ならできる)

Firefox は wasm の compile を eval と同じ扱いにする。**親プロセスでは principal を問わず止まる**
(`security.allow_eval_in_parent_process` を立てない限り)。browser.xhtml に効く actor は親プロセス
そのものなので、view と同じ thread に logic は置けない。

**ChromeWorker の中なら通る。** worker の `ContentSecurityPolicyAllows`(runtime の
`dom/workers/RuntimeService.cpp`)は、JS の eval だけ `nsContentSecurityUtils::IsEvalAllowed` に通して、
**WASM は worker 自身の CSP しか見ない**。ChromeWorker に CSP は無いので、compile は普通に通る。
測った(2026-09-08、実機):

| どこで | |
|---|---|
| 親の main thread(system principal) | `CompileError: call to WebAssembly.compile() blocked by CSP` |
| 親の main thread + content principal の `Cu.Sandbox` | 同じく blocked |
| 親プロセスの `ChromeWorker` | **ok**(Tsubaki の runtime を丸ごと起こして `tsubakiEval` まで) |

なので tooling は drop の logic を `ops-worker.js`(ChromeWorker)に置く。view の thread も空く。
将来 runtime 側が worker の wasm も同じ check に通すようにしたら、そのときは content プロセスの
ページに逃がす道がある(隠し `<browser remote="true">` は content プロセスに行くことを測ってある)。

### jar の中の .wasm は MIME でつまずく

jar channel は `application/wasm;charset=utf-8` を返し、`instantiateStreaming` は厳密に
`application/wasm` しか受けない。child は sandbox の中で `instantiateStreaming` を
「bytes を読んで `instantiate`」に差し替えている(`tooling/webext-actors/build.ts`)。

### Tsubaki の書き味で踏むもの

webpanel を書いていて踏んだ五つ(Dict の `=>` が無い / array literal の中の三項と range / 末尾コンマ /
`;` 無しの kwarg / comprehension の要素が複数行に跨げない)は **runtime 0.3.0(tsubaki `e90b368`)で言語側が直した**。
0.3.0 より前の runtime を使う drop では、まだ踏む。

`copy` と `put`、それに `get(d, :key, 既定)` は **std が持つ**(`drops/std-tsubaki-runtime/src/ops/std.tsubaki`。
runtime 0.4.1 から、drop 自身の ops より先に読まれる)。いまも無いもの: `findfirst`、`isempty`、`Set`。
`vcat` は Array 用で、数の Vector には効かない。

### `:type` は書けない、`d[:key]` は教えられない

`type` は Tsubaki のキーワードなので `:type` が parse できない(Julia では書ける)。その key だけ文字のままにした。
`d[:key]` のほうは、indexing が dispatch を通らないので std からは教えられない — `get(d, :key, 既定)` を使う。

## build / reproducible

### actor.ts の木は build のときに一度 import される

build.ts は `meta` を読むために actor.ts を読み込む。だから **module 直下で browser に触ると build が転ぶ**。
`data/prefs.ts` に `definePrefs(...)` を置いたら `Services is not defined` で止まった。
schema は data(定数)、そこから prefs を作るのは content hook の中(`actor.ts`)。

### zip の時刻は 2 秒刻み、PR の merge commit は秒がずれる

CI(PR)は merge commit を checkout するので、commit の時刻が手元と数秒ずれ、xpi の bytes が変わった。
いま: 版と mtime は commit の時刻を **分** に丸める。CI は `pull_request.head.sha` を checkout する。

### `TZ` と `touch`

手で BUILD.md をなぞったとき、`touch -t` がローカル時刻で解釈されて bytes が変わった。`TZ=UTC` を忘れない。
zip は `-q -X -D`(extra field 無し、dir entry 無し)、file 一覧は sort して渡す、権限は 644 / 755。

### 一行 sed が当たらない

生成された JS は引数が改行をまたぐことがある。前の api.js がそうだった(いまの parent/child.sys.mjs は一行)。
書き換えは正規表現で「丸ごと」当てて、当たらなかったら abort する(黙って素通りさせない)。

### `deno.lock` と `--frozen`

依存を lock と違う版で取ると bytes が変わる。`deno install --frozen` で、lock に無いものが来たら止める。
tooling を上げるときは lock も作り直して commit。

### 壊れた印を入れて一日溶かした

content.js に `\n` を文字通り書いてしまい SyntaxError。固める前に `deno check --quiet` で parse する。
minify(一行 400 文字超)も断る。読めない JS は drop にしない。

## CI / GitHub

### `paths` に無い変更は workflow が走らず、必須 check が「Expected — Waiting」のまま

workflow 自身と README だけ変えた PR で起きた。`.github/workflows/**` を `paths` に足した。
道具(tooling / scripts)が変わった PR は drop を全部 build して確かめる。

### `sign` は environment `registry` の承認待ちで止まる(わざと)

main に入っただけでは判は押されない。Actions → Review deployments → approve。
PR の中では id-token が無いので判は押せない。fork からの PR は外の人なら毎回 承認。

### push の `paths: drops/**` だけだと、道具の変更では何も置き直されない

`workflow_dispatch`(name)で手で置き直す。

### CI に B2 の鍵は無い

置くのは `dl.f3liz.casa/drop/<uuid>` への multipart POST。Worker が判と sha256 を確かめてから B2 に書く。
判が通らないものは置けないし、配られもしない(403 に理由)。巻き戻し(古い commit_time)も断る。

### 浅い checkout に fetch しても、合流点は降りてこない

sign job が台帳を積むとき、`ledger/versions` に `main` を merge する。checkout が `fetch-depth: 2` だと、
`git fetch origin main ledger/versions` をしても二つの本当の合流点はその窓の外に残るので、
git からは related なのに unrelated に見えて `fatal: refusing to merge unrelated histories` で止まる。
枝があるせいでも、履歴が壊れているせいでもない(`git merge-base` は手元ではちゃんと答える)。
sign の checkout は `fetch-depth: 0`。2026-09-08、std-tsubaki-runtime 0.2.0 で踏んだ
(判は押されて置かれたあと、台帳を積むところだけが落ちた)。

## 手元で見るとき

### BiDi で about: の中を評価するには `--remote-allow-system-access`

無いと "System access is required"。noraneko の dev はこの flag 付きで起動する。
`ws://127.0.0.1:5180/session` → `session.new` → `browsingContext.create` → `script.evaluate`。
about:nora:settings は system principal なので、そこから `ChromeUtils.importESModule` で親側を叩ける。

### BiDi の session は一つしか持てない

script が途中で死ぬと session が残って "Maximum number of active sessions"。終わるときは `session.end`。
残ったら browser を立て直すしかない。

### vite が残る

親(feles-build)が SIGKILL で落ちると vite が孤児になり、次の起動で port を塞ぐ(5174 を取られた vite が 5180 に逃げて、
browser の BiDi port を塞いだことがある)。いまは起動時に「`npm:vite` で cwd がこの repo」の process を片づける。

### 「見えない」の切り分け

1. 親は動いているか(chrome から `parent.<method>()` を呼ぶ、数を数える)
2. ページに届いているか(documentElement に属性を付けて、ページの中から読む)
3. 届いていないなら matches / remoteTypes / event(actor.json)を疑う。content script なら about: の罠。

### `insertBefore` は、同じ位置へでも「取り出して、入れ直す」

DOM の `insertBefore` は移動ではない。node を**外して**から入れる。ふつうの `<label>` なら
何も失われないが、chrome の窓が持っているものは、外された時点で終わる:

    <browser>   ページが壊されて読み直される(browsingContext が別のものになる)
    <input>     焦点と caret が飛ぶ
    <video>     再生が最初から

実機で確かめた: **同じ位置への no-op な `insertBefore` でも** `<browser>` の
browsingContext は作り直された。`moveBefore`(DOM の、状態を保つ移動)なら、並び替えても
親を跨いでも同じまま。`<browser>` に `connectedMoveCallback` があるのはこのため。

preact の挿入は `diff/children.js` の `insert()` **一か所だけ**なので、std-preact-xul 1.1.0 は
`mount()` が置いたものに、`moveBefore` を先に試す `insertBefore` を着せている
(繋がっていない node には `HierarchyRequestError` が飛ぶので、そこで元の道に落ちる)。
**view の要素に `key` を書くこと**。key が無いと preact は移動ではなく作り直しを選ぶ。

見るには: Firefox を `--marionette --remote-allow-system-access` で起こして、chrome context で
`el.browsingContext.id` を並び替えの前後で比べる(`--headless` でよい)。
