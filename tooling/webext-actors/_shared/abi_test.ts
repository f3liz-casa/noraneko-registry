// SPDX-License-Identifier: MPL-2.0
// 殻が drop に許していることの表(abi/v1.json)が、本当に効いているか。
//
//     mise exec -- deno test --no-check --allow-read --config deno.test.json _shared/
//
// ここが緩むと、入れる人の画面に出ている「これ以外のことはできません」が嘘になる。

import { assert, assertEquals, assertFalse, assertThrows } from "jsr:@std/assert@^1.0.0";
import abi from "../abi.json" with { type: "json" };
import { allowProp, toPreact } from "./vnode.ts";

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
