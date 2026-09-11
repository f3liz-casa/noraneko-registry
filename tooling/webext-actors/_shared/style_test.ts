// SPDX-License-Identifier: MPL-2.0
// data → CSS。**印字できるものしか印字しない**ことを、ここで押さえる。
//
//     mise exec -- deno test --config /tmp/deno-nogecko.json _shared/style_test.ts
//
// (deno.json の types が jsr から降りてこないので、検査だけ別の config で走らせる)

import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1.0.0";
import { classOf, declarations, isNested, makeSheet, printStyle, rule } from "./style.ts";

const len = (n: number, unit: string) => ({ __type: "Len", n, unit });

Deno.test("数は px、単位を持たない property は素の数", () => {
  assertEquals(declarations({ width: 40, order: 5, opacity: 1 }), "width: 40px; order: 5; opacity: 1");
});

Deno.test("Len は単位つき、pct は %", () => {
  assertEquals(declarations({ width: len(40, "px"), height: len(50, "pct") }), "width: 40px; height: 50%");
});

Deno.test("名前の `_` は `-`、頭の `_` は頭の `-`", () => {
  assertEquals(
    declarations({ min_width: 40, _moz_context_properties: "fill" }),
    "min-width: 40px; -moz-context-properties: fill",
  );
});

Deno.test("並びは空白で連ねる", () => {
  assertEquals(declarations({ border_inline: [len(1, "px"), "solid", "currentColor"] }), "border-inline: 1px solid currentColor");
});

Deno.test("url( は印字しない -- 外に電話する口は、書きかたごと無い", () => {
  assertEquals(declarations({ background: "url(https://example.com/x.png)" }), "");
  assertEquals(declarations({ background: "image-set('a.png' 1x)" }), "");
});

Deno.test("`;` で宣言の外に出ようとしたら、その宣言ごと落ちる", () => {
  assertEquals(declarations({ color: "red; position: fixed" }), "");
});

Deno.test("知らない単位は印字しない", () => {
  assertEquals(declarations({ width: len(40, "parsec") }), "");
});

Deno.test("property の名前として読めないものは落とす", () => {
  assertEquals(declarations({ "color:red;x": 1 }), "");
});

Deno.test("入れ子があるかどうかで、置き場所が変わる", () => {
  assertEquals(isNested({ width: 40 }), false);
  assertEquals(isNested({ width: 40, ":hover": { opacity: 1 } }), true);
  assertEquals(isNested({ "@media (prefers-color-scheme: dark)": { color: "white" } }), true);
});

Deno.test("入れ子は CSS nesting でそのまま出る", () => {
  const css = rule(".x", { width: 40, ":hover": { opacity: 1 }, " .icon": { width: 20 } });
  assertStringIncludes(css, "width: 40px;");
  assertStringIncludes(css, "&:hover {");
  assertStringIncludes(css, "& .icon {");
});

Deno.test("selector に `{` や @import は書けない", () => {
  assertEquals(rule(":hover { } body", { width: 40 }), "");
  assertEquals(rule("@import url(x)", { width: 40 }), "");
});

Deno.test("同じ中身は同じ class、鍵の並びは関係ない", () => {
  assertEquals(classOf({ width: 40, gap: 2 }), classOf({ gap: 2, width: 40 }));
  assertEquals(classOf({ width: 40 }) === classOf({ width: 41 }), false);
});

Deno.test("sheet は同じ class を二度書かない", () => {
  const out: string[] = [];
  const sheet = makeSheet((css) => out.push(css));
  const data = { width: 40, ":hover": { opacity: 1 } };
  const a = sheet.classFor(data);
  const b = sheet.classFor({ ":hover": { opacity: 1 }, width: 40 });
  assertEquals(a, b);
  assertEquals(out.length, 1);
  assertStringIncludes(out[0], `.${a} {`);
});

Deno.test("平らなら style 属性、入れ子があれば class", () => {
  const out: string[] = [];
  const sheet = makeSheet((css) => out.push(css));
  assertEquals(printStyle({ width: 40 }, sheet), { style: "width: 40px" });
  const nested = printStyle({ width: 40, ":hover": { opacity: 1 } }, sheet);
  assertEquals(nested.style, undefined);
  assertStringIncludes(String(nested.class), "nora-");
});
