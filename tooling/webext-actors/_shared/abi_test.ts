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
  assertFalse(quiet(() => allowProp("image", "src", "http://example.com/a.png")));
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
