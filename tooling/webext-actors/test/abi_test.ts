// SPDX-License-Identifier: MPL-2.0
// 殻が drop に許していることの表(abi/v1.json)が、本当に効いているか。
//
//     mise exec -- deno test --no-check --allow-read --config deno.test.json _shared/
//
// ここが緩むと、入れる人の画面に出ている「これ以外のことはできません」が嘘になる。

import { assert, assertEquals, assertFalse, assertThrows } from "jsr:@std/assert@^1.0.0";
import abi from "../../../abi/v1.json" with { type: "json" };
import { allowProp, toPreact } from "../../../drops/std-actor/src/lib/vnode.ts";
import { COMMANDS } from "../../../drops/std-actor/src/lib/commands.ts";

const quiet = <T>(fn: () => T): T => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = warn;
  }
};

Deno.test("表が、四つとも中身を持っている", () => {
  assert(abi.tags.length > 0);
  assert(abi.props.any.length > 0);
  assert(Object.keys(abi.permissions).length > 0);
  assert(Object.keys(abi.effects).length > 0);
});

Deno.test("effect が名指しする permission は、表にある名前だけ", () => {
  for (const [name, e] of Object.entries(abi.effects)) {
    if (e.permission === null) continue;
    assert(
      Object.hasOwn(abi.permissions, e.permission),
      `effect ${name} が知らない permission を指している: ${e.permission}`,
    );
  }
  for (const [name, f] of Object.entries(abi.facts)) {
    if (f.permission === null) continue;
    assert(
      Object.hasOwn(abi.permissions, f.permission),
      `fact ${name} が知らない permission を指している: ${f.permission}`,
    );
  }
});

Deno.test("段のある permission は、段ごとに日本語がある", () => {
  for (const [name, p] of Object.entries(abi.permissions)) {
    if (p.shape !== "level") continue;
    const levels = (p as { levels?: Record<string, string> }).levels ?? {};
    assert(Object.keys(levels).length > 0, `${name} に段が一つも無い`);
    for (const [step, ja] of Object.entries(levels)) {
      assert(ja.length > 0, `${name} の ${step} に日本語が無い(入れる人の画面に何も出ない)`);
    }
  }
});

// 表に有る段は、**その段の effect が殻に有る**ことでもある。まだ無い段を先に
// 載せると、入れる人の画面に裏づけの無い行が出るので、そこは数で見張っておく。
Deno.test('tabs の段は、読む と 手を入れる の二つ', () => {
  assertEquals(Object.keys((abi.permissions.tabs as { levels: Record<string, string> }).levels), [
    "read",
    "write",
  ]);
});

// 段を名指しする effect は、その permission の段に本当に有る名前を言っていること。
// ここがずれると、check-drop が「段が足りない」と言えなくなって、殻だけが断る
// ── つまり、出したあとに実機で気づくことになる。
Deno.test("段を名指しする effect は、その permission に有る段を言っている", () => {
  const effects = abi.effects as Record<string, { permission?: string | null; level?: string }>;
  for (const [name, e] of Object.entries(effects)) {
    if (!e.level) continue;
    const p = abi.permissions[e.permission ?? ""] as { shape?: string; levels?: Record<string, string> };
    assertEquals(p?.shape, "level", `effect ${name} が、段を持たない permission の段を名指ししている`);
    assert(Object.hasOwn(p.levels ?? {}, e.level), `effect ${name}: ${e.permission} に ${e.level} という段が無い`);
  }
});

Deno.test("混ぜられる menu は、本体のどの popup かを持っている", () => {
  for (const [name, m] of Object.entries(abi.menus as Record<string, { id?: string; about?: string }>)) {
    if (name === "note") continue;
    assert(m.id, `menus の ${name} に id が無い(どの popup か分からない)`);
    if (m.about) assertEquals(m.about, "tab", `menus の ${name}: いま分かる about は "tab" だけ`);
  }
});

Deno.test("見ていられる出来事は、聞く名前を持っている", () => {
  for (const [name, e] of Object.entries(abi.tab_events as Record<string, { event?: string }>)) {
    if (name === "note") continue;
    assert(e.event, `tab_events の ${name} に event が無い(何を聞けばいいのか分からない)`);
  }
});

// 目印の名前に uuid が入っているのが、**二枚の drop が混ざらない**ということ。
// ここが短くなると、同じ名前を使う二枚が、静かに互いの目印を消し合う。
Deno.test("タブの目印は、その drop のものだと名前で分かる", () => {
  assert(abi.mark_attr.prefix.startsWith("data-nora-"));
  assert(abi.mark_attr.prefix.includes("<uuid>"));
  assertEquals(abi.mark_attr.token, "{attr}");
});

Deno.test("names の permission は、日本語に {names} の place がある", () => {
  for (const [name, p] of Object.entries(abi.permissions)) {
    if (p.shape !== "names") continue;
    assert(p.ja.includes("{names}"), `${name} の ja に {names} が無い(何を許したのか出ない)`);
  }
});

Deno.test("表に有る属性は通る", () => {
  assert(allowProp("vbox", "id", "x"));
  assert(allowProp("toolbarbutton", "tooltiptext", "ねこ"));
  assert(allowProp("label", "aria-label", "ねこ")); // prefixes
});

Deno.test("表に無い属性は落ちる", () => {
  assertFalse(quiet(() => allowProp("div", "dangerouslySetInnerHTML", "<b>")));
  assertFalse(quiet(() => allowProp("div", "onclick", "alert(1)")));
  assertFalse(quiet(() => allowProp("div", "srcdoc", "<b>")));
});

Deno.test("URL の属性は、表に挙げた scheme だけ", () => {
  assert(allowProp("image", "src", "https://example.com/a.png"));
  assert(allowProp("toolbarbutton", "image", "page-icon:https://example.com/"));
  assertFalse(quiet(() => allowProp("image", "src", "ftp://example.com/a.png")));
  assertFalse(quiet(() => allowProp("image", "src", "javascript:alert(1)")));
  assertFalse(quiet(() => allowProp("a", "href", "file:///etc/passwd")));
});

Deno.test("知らない tag は、その場で断る", () => {
  assertThrows(() => toPreact({ tag: "iframe", props: {}, kids: [] }, () => {}));
  assertThrows(() => toPreact({ tag: "script", props: {}, kids: [] }, () => {}));
});

Deno.test("<browser> は宣言した drop だけ", () => {
  assertThrows(() => toPreact({ tag: "browser", props: {}, kids: [] }, () => {}));
  const ok = toPreact({ tag: "browser", props: {}, kids: [] }, () => {}, { webFrame: true });
  assertEquals(typeof ok, "object");
});

Deno.test("Firefox 自身のアイコンは通る。ほかの chrome: は通らない", () => {
  assert(allowProp("toolbarbutton", "image", "chrome://global/skin/icons/plus.svg"));
  assertFalse(quiet(() => allowProp("toolbarbutton", "image", "chrome://browser/content/browser.xhtml")));
});

Deno.test("<browser> に載せる URL は http も https も", () => {
  assert(allowProp("browser", "src", "http://example.com/"));
  assert(allowProp("browser", "src", "https://example.com/"));
});

// ここが、この試験でいちばん効くところ。表は「殻ができること」ではなく
// 「drop が実際に書いていること」と合っていないと意味がない -- 表のほうが狭いと、
// drop は静かに絵を失う(実際に一度そうなった: plus.svg が chrome:// で落ちた)。
// 手元の輪(drop test)ができるまでの、いちばん安い見張り。
Deno.test("registry の drop が書いている URL は、全部この表を通る", async () => {
  const root = new URL("../../../drops/", import.meta.url);
  let dirs: Deno.DirEntry[];
  try {
    dirs = [...Deno.readDirSync(root)];
  } catch {
    return; // stage の中(drops/ が無い)では、この試験は無い
  }
  const literal = /"(src|image|href)"\s*=>\s*"([^"]+)"/g;
  const bad: string[] = [];
  for (const d of dirs) {
    if (!d.isDirectory) continue;
    const ops = new URL(`${d.name}/src/`, root);
    let files: string[];
    try {
      files = [...Deno.readDirSync(ops)].flatMap((a) => {
        try {
          return [...Deno.readDirSync(new URL(`${a.name}/ops/`, ops))]
            .filter((f) => f.name.endsWith(".tsubaki"))
            .map((f) => `${a.name}/ops/${f.name}`);
        } catch {
          return [];
        }
      });
    } catch {
      continue;
    }
    for (const f of files) {
      const text = Deno.readTextFileSync(new URL(f, ops));
      for (const m of text.matchAll(literal)) {
        if (!quiet(() => allowProp("x", m[1], m[2]))) bad.push(`${d.name}/${f}: ${m[1]} = ${m[2]}`);
      }
    }
  }
  assertEquals(bad, [], `表に無い URL を書いている drop がある:\n  ${bad.join("\n  ")}`);
});

// 同じ筋で、menu の名前も。表に無い名前を書いた drop は、実機では行が出ないだけ
// (console に一行は出るが、出す前に言えるなら、そのほうがいい)。
Deno.test("registry の drop が名指ししている menu は、表に有る", () => {
  const root = new URL("../../../drops/", import.meta.url);
  let dirs: Deno.DirEntry[];
  try {
    dirs = [...Deno.readDirSync(root)];
  } catch {
    return; // stage の中(drops/ が無い)では、この試験は無い
  }
  const bad: string[] = [];
  for (const d of dirs) {
    if (!d.isDirectory) continue;
    const src = new URL(`${d.name}/src/`, root);
    let actors: Deno.DirEntry[];
    try {
      actors = [...Deno.readDirSync(src)];
    } catch {
      continue;
    }
    for (const a of actors) {
      let ops: Deno.DirEntry[];
      try {
        ops = [...Deno.readDirSync(new URL(`${a.name}/ops/`, src))];
      } catch {
        continue;
      }
      for (const f of ops) {
        if (!f.name.endsWith(".tsubaki")) continue;
        const text = Deno.readTextFileSync(new URL(`${a.name}/ops/${f.name}`, src));
        for (const m of text.matchAll(/\bmenu\s*=\s*"([^"]+)"/g)) {
          if (!Object.hasOwn(abi.menus, m[1])) bad.push(`${d.name}/${a.name}: 表に無い menu ${m[1]}`);
        }
      }
    }
  }
  assertEquals(bad, [], `\n  ${bad.join("\n  ")}`);
});

// --- 言葉(t(:key) → 字) -------------------------------------------------------

Deno.test("鍵は、選び終わった表の字になる", () => {
  const node = { tag: "label", props: { value: { __type: "T", key: "add" } }, kids: [] };
  const out = toPreact(node, () => {}, { text: { add: "いまのタブを足す" } }) as
    { props: Record<string, unknown> };
  assertEquals(out.props.value, "いまのタブを足す");
});

Deno.test("子の位置の鍵も、字になる", () => {
  const node = { tag: "description", props: {}, kids: [{ __type: "T", key: "close" }] };
  const out = toPreact(node, () => {}, { text: { close: "閉じる" } }) as { kids: unknown[] };
  assertEquals(out.kids, ["閉じる"]);
});

Deno.test("並べていない鍵は、鍵そのものが出る(黙って消えない)", () => {
  const node = { tag: "label", props: { value: { __type: "T", key: "nope" } }, kids: [] };
  const out = quiet(() => toPreact(node, () => {}, { text: {} })) as
    { props: Record<string, unknown> };
  assertEquals(out.props.value, "nope");
});

Deno.test("字にしても、属性の表は通る", () => {
  const node = { tag: "label", props: { onclick: { __type: "T", key: "add" } }, kids: [] };
  const out = quiet(() => toPreact(node, () => {}, { text: { add: "x" } })) as
    { props: Record<string, unknown> };
  assertEquals(out.props.onclick, undefined);
});

// registry の drop が t(:key) で呼んでいる鍵が、strings.toml に並んでいるか。
// 並んでいないと実機で鍵がそのまま出る -- 出てはいるので気づけるが、出す前に言う。
Deno.test("drop が呼んでいる鍵は、strings.toml に並んでいる", () => {
  const root = new URL("../../../drops/", import.meta.url);
  let dirs: Deno.DirEntry[];
  try {
    dirs = [...Deno.readDirSync(root)];
  } catch {
    return;
  }
  const bad: string[] = [];
  for (const d of dirs) {
    if (!d.isDirectory) continue;
    const src = new URL(`${d.name}/src/`, root);
    let actors: Deno.DirEntry[];
    try {
      actors = [...Deno.readDirSync(src)];
    } catch {
      continue;
    }
    for (const a of actors) {
      let ops: Deno.DirEntry[];
      try {
        ops = [...Deno.readDirSync(new URL(`${a.name}/ops/`, src))];
      } catch {
        continue;
      }
      const used = new Set<string>();
      for (const f of ops) {
        if (!f.name.endsWith(".tsubaki")) continue;
        const text = Deno.readTextFileSync(new URL(`${a.name}/ops/${f.name}`, src));
        for (const m of text.matchAll(/\bt\(:([A-Za-z_][A-Za-z0-9_]*)\)/g)) used.add(m[1]);
      }
      if (used.size === 0) continue;
      let strings = "";
      try {
        strings = Deno.readTextFileSync(new URL(`${a.name}/strings.toml`, src));
      } catch {
        bad.push(`${d.name}/${a.name}: t(:...) を使っているのに strings.toml が無い`);
        continue;
      }
      const en = strings.split(/^\s*\[/m).find((s) => s.startsWith("en]")) ?? "";
      for (const key of used) {
        if (!new RegExp(`^\\s*${key}\\s*=`, "m").test(en)) {
          bad.push(`${d.name}/${a.name}: t(:${key}) の字が [en] に無い`);
        }
      }
    }
  }
  assertEquals(bad, [], `\n  ${bad.join("\n  ")}`);
});

// --- 鍵(<key> と、押しかた) ---------------------------------------------------
// 宣言に並んだ字と、実際に押せる鍵が、同じ一つの字から出ているか。ここが緩むと
// 「キーボードの Accel+Alt+Z を受け取ります」と出したまま、別の鍵を取れてしまう。

/**
 * 要素に本当に書かれるもの。`ref` まで呼ぶ -- preact は `key` を「並べ替えの
 * 目印」として自分のものにするので、押す字はそこを通って属性になる。
 * (試験の h は _test_std.ts の小さいほうなので、ref は props に残っている)
 */
function attrsOf(v: unknown): Record<string, string> {
  const node = v as { props?: Record<string, unknown>; ref?: (el: unknown) => void } | null;
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(node?.props ?? {})) {
    if (k === "children" || k === "ref") continue;
    out[k] = typeof x === "function" ? "(関数)" : String(x);
  }
  const ref = (node?.props?.ref ?? node?.ref) as ((el: unknown) => void) | undefined;
  ref?.({ setAttribute: (n: string, val: string) => (out[n] = val) });
  return out;
}
const aKey = (combo: string) => ({ tag: "key", props: { combo }, kids: [] });

Deno.test("宣言した組み合わせは、XUL の押しかたに綴り直される", () => {
  const out = attrsOf(toPreact(aKey("Accel+Alt+Z"), () => {}, { keys: ["Accel+Alt+Z"] }));
  assertEquals(out.modifiers, "accel alt");
  assertEquals(out.key, "Z");
});

Deno.test("指の順も大小も、押しかたを変えない", () => {
  const out = attrsOf(toPreact(aKey("alt+ACCEL+z"), () => {}, { keys: ["Accel+Alt+Z"] }));
  assertEquals(out.key, "Z");
});

Deno.test("名前のある鍵は keycode に(指が無ければ modifiers も無い)", () => {
  const out = attrsOf(toPreact(aKey("F2"), () => {}, { keys: ["F2"] }));
  assertEquals(out.keycode, "VK_F2");
  assertEquals(out.modifiers, undefined);
});

Deno.test("宣言に無い組み合わせは、その <key> だけ置かない", () => {
  assertEquals(quiet(() => toPreact(aKey("Ctrl+T"), () => {}, { keys: ["F2"] })), null);
});

Deno.test("一つ落ちても、隣の鍵は生きている", () => {
  const node = { tag: "fragment", props: {}, kids: [aKey("Ctrl+T"), aKey("F2")] };
  const out = quiet(() => toPreact(node, () => {}, { keys: ["F2"] })) as { kids: unknown[] };
  assertEquals(out.kids[0], null);
  assertEquals(attrsOf(out.kids[1]).keycode, "VK_F2");
});

Deno.test("keys を宣言していない drop は、<key> を書けない", () => {
  assertThrows(() => toPreact(aKey("F2"), () => {}, {}));
});

// drop.toml に並んだ字が、殻の読める綴りか。読めない字は実機で「宣言はしたのに
// 鍵が置かれない」になる -- 出している行だけが残るので、出す前にここで言う。
Deno.test("registry の drop が宣言した鍵は、全部この綴りで読める", () => {
  const root = new URL("../../../drops/", import.meta.url);
  let dirs: Deno.DirEntry[];
  try {
    dirs = [...Deno.readDirSync(root)];
  } catch {
    return; // stage の中(drops/ が無い)では、この試験は無い
  }
  const bad: string[] = [];
  for (const d of dirs) {
    if (!d.isDirectory) continue;
    let toml = "";
    try {
      toml = Deno.readTextFileSync(new URL(`${d.name}/drop.toml`, root));
    } catch {
      continue;
    }
    const line = toml.match(/^\s*keys\s*=\s*\[([^\]]*)\]/m);
    if (!line) continue;
    for (const m of line[1].matchAll(/"([^"]*)"/g)) {
      const combo = m[1];
      const out = quiet(() => toPreact(aKey(combo), () => {}, { keys: [combo] }));
      if (out === null) bad.push(`${d.name}: ${combo}`);
    }
  }
  assertEquals(bad, [], `殻が読めない押しかたを宣言している drop がある:\n  ${bad.join("\n  ")}`);
});

// --- 命令の表(DoCommand) -------------------------------------------------------
// 表は二枚ある: abi/v1.json の commands(名前と、入れる人に出る日本語)と、
// commands.ts(その名前が呼ぶもの)。**どちらか片方にだけ有る名前**が、いちばん
// 静かに壊れる ── 宣言は通るのに何も起きない、あるいは画面に出ないのに動く。

Deno.test("命令の表は、abi と殻で同じ顔ぶれ", () => {
  assertEquals(Object.keys(COMMANDS).sort(), Object.keys(abi.commands).sort());
});

Deno.test("命令には、入れる人に出る日本語が一つずつある", () => {
  for (const [name, c] of Object.entries(abi.commands)) {
    assert((c as { ja: string }).ja.length > 0, `${name} に ja が無い`);
  }
});

// drop.toml が宣言した命令が表に無いと、宣言だけが画面に出て、何も起きない。
Deno.test("registry の drop が宣言した命令は、全部表にある", () => {
  const root = new URL("../../../drops/", import.meta.url);
  let dirs: Deno.DirEntry[];
  try {
    dirs = [...Deno.readDirSync(root)];
  } catch {
    return; // stage の中(drops/ が無い)では、この試験は無い
  }
  const bad: string[] = [];
  for (const d of dirs) {
    if (!d.isDirectory) continue;
    let toml = "";
    try {
      toml = Deno.readTextFileSync(new URL(`${d.name}/drop.toml`, root));
    } catch {
      continue;
    }
    const line = toml.match(/^\s*commands\s*=\s*\[([\s\S]*?)\]/m);
    if (!line) continue;
    for (const m of line[1].matchAll(/"([^"]*)"/g)) {
      if (!Object.hasOwn(abi.commands, m[1])) bad.push(`${d.name}: ${m[1]}`);
    }
  }
  assertEquals(bad, [], `表に無い命令を宣言している drop がある:\n  ${bad.join("\n  ")}`);
});

// --- ツールバーの置き場所 -------------------------------------------------------

Deno.test("toolbar の area には、日本語の名前が一つずつある", () => {
  const areas = Object.entries(abi.toolbar_areas).filter(([k]) => k !== "note");
  assert(areas.length > 0);
  for (const [name, ja] of areas) {
    assert(typeof ja === "string" && ja.length > 0, `${name} に名前が無い`);
  }
});

// --- ブラウザ自身のページ(browser_pages) ----------------------------------------
// drop は chrome:// の綴りを一度も書かない。書けるのは名前だけで、その名前が
// **表に有る**ことと **宣言に有る**ことの両方を通ったときだけ、窓が読み込む。

const aFrame = (page: string) => ({ tag: "browser", props: { page }, kids: [] });
const framePolicy = { webFrame: true, browserPages: ["bookmarks"] };

Deno.test("browser_pages の一行ずつに、日本語と読み込む先がある", () => {
  for (const [name, p] of Object.entries(abi.browser_pages)) {
    if (name === "note") continue;
    const row = p as { ja: string; url: string };
    assert(row.ja?.length > 0, `${name} に ja が無い`);
    assert(row.url?.length > 0, `${name} に url が無い`);
  }
});

Deno.test("宣言した名前は、表の URL になる", () => {
  const out = toPreact(aFrame("bookmarks"), () => {}, framePolicy) as
    { props: Record<string, unknown> };
  assertEquals(out.props.src, abi.browser_pages.bookmarks.url);
  assertEquals(out.props.page, undefined); // 名前は属性として出ていかない
});

Deno.test("ブラウザ自身のページは、remote な窓では開かない", () => {
  const own = toPreact(aFrame("bookmarks"), () => {}, framePolicy) as
    { props: Record<string, unknown> };
  assertEquals(own.props.remote, undefined);
  assertEquals(own.props.type, undefined);
  // web のほうは今までどおり content の、別のプロセスの窓
  const web = toPreact(
    { tag: "browser", props: { src: "https://example.com/" }, kids: [] },
    () => {},
    { webFrame: true },
  ) as { props: Record<string, unknown> };
  assertEquals(web.props.remote, "true");
  assertEquals(web.props.type, "content");
});

Deno.test("表に無いページは、その <browser> だけ置かない", () => {
  assertEquals(quiet(() => toPreact(aFrame("preferences"), () => {}, framePolicy)), null);
});

Deno.test("宣言に無いページも、その <browser> だけ置かない", () => {
  assertEquals(quiet(() => toPreact(aFrame("history"), () => {}, framePolicy)), null);
});

Deno.test("名前を使わない <browser> に、勝手な chrome: は載らない", () => {
  const out = toPreact(
    { tag: "browser", props: { src: "chrome://browser/content/browser.xhtml" }, kids: [] },
    () => {},
    { webFrame: true },
  ) as { props: Record<string, unknown> };
  assertEquals(out.props.src, undefined);
});

Deno.test("registry の drop が宣言したページは、全部表にある", () => {
  const root = new URL("../../../drops/", import.meta.url);
  let dirs: Deno.DirEntry[];
  try {
    dirs = [...Deno.readDirSync(root)];
  } catch {
    return;
  }
  const bad: string[] = [];
  for (const d of dirs) {
    if (!d.isDirectory) continue;
    let toml = "";
    try {
      toml = Deno.readTextFileSync(new URL(`${d.name}/drop.toml`, root));
    } catch {
      continue;
    }
    const line = toml.match(/^\s*browser_pages\s*=\s*\[([\s\S]*?)\]/m);
    if (!line) continue;
    for (const m of line[1].matchAll(/"([^"]*)"/g)) {
      if (!Object.hasOwn(abi.browser_pages, m[1])) bad.push(`${d.name}: ${m[1]}`);
    }
  }
  assertEquals(bad, [], `表に無いページを宣言している drop がある:\n  ${bad.join("\n  ")}`);
});
