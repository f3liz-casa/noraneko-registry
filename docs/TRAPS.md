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

### 古い形の xpi は、新しい noraneko に入らない

`actor.json` が無い xpi は `NoraActors.readActorJson` で落ちる。逆(新しい xpi を古い noraneko に)は、
content script が about: に入らないので、入るけど何も起きない。
道具(tooling/)を替えたら、配っている drop を全部 `workflow_dispatch` で置き直す。

### `resource://` の先が `jar:file:` だと `fetch()` は NetworkError

xpi の中の `actor.json` を `fetch("resource://<alias>/actor.json")` で読もうとして落ちた。
`NetUtil.asyncFetch({ uri, loadUsingSystemPrincipal: true })` なら読める。`importESModule` と `loadSubScript` は平気。

### `importESModule` は `jar:file:` を信用しない

"System modules must be loaded from a trusted scheme"。だから入れる側が `resource://noraneko-drop-<namespace>-<name>-<版>/` を
xpi の root に張り、xpi の中の `parent.sys.mjs` / `child.sys.mjs` はその URL を指す(build-drop.rb が書き換える)。
`setSubstitutionWithFlags(..., ALLOW_CONTENT_ACCESS)` で。content process にも同じ別名が届く。

### 別名に版を入れる理由

module cache は URL 単位。同じ session で drop の版を替えたとき、別名が同じだと古い module が残る。
だから `noraneko-drop-<namespace>-<name>-<版>`。

### about:newtab は先読みされている

Firefox は次の新しいタブを裏で先に作っておく。drop を入れた直後の一枚は、入れる前に作られたもののことがある。
「入れたのに出ない」は、もう一枚開いてから判断する。

### 「動いた」の根拠を取り違える

marker9 のとき「[drop-marker] getData is running from the DROP」が出て安心したが、それを呼んでいたのは
background.js(親側)で、content script ではなかった。親が動く証拠と、ページに届いた証拠は別。
ページに届いたかは、ページの DOM に印を付けて、ページの中から読む(BiDi、下)。

## build / reproducible

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

`workflow_dispatch`(name = `@<namespace>/<name>`)で手で置き直す。

### CI に B2 の鍵は無い

置くのは `dl.f3liz.casa/drop/@<namespace>/<name>` への multipart POST。Worker が判と sha256 を確かめてから B2 に書く。
判が通らないものは置けないし、配られもしない(403 に理由)。巻き戻し(古い commit_time)も断る。

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
