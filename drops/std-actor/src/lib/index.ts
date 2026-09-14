// SPDX-License-Identifier: MPL-2.0

// std-actor: drop の**殻**。
//
// actor.ts を書かない drop(logic も actor も Tsubaki)の中身は、どれも同じです ──
// logic の三つの door(setup / start / dispatch)を呼んで、返ってきた view を描き、
// effect を carry out する。前はその殻が **どの drop の xpi にも一枚ずつ**入って
// いました(content.js の 63KB のうち、ほとんどがこれ)。同じ bytes を十九枚配って
// いたことになるし、入れる人が読むものも、自分の drop の 3KB のために殻の 15 枚を
// めくる形になっていました。
//
// lib にすると、配られるのは一枚だけ。drop の xpi に残るのは、その drop 自身の
// 宣言と logic と、殻を呼ぶ数行になります。
//
// 版が上がっても、**すでに組んである drop は組み直すまで前の版のまま**です
// (deps の版は使う側が build したときに固定される)。何と何が合うのかは台帳に残る。

export { runTsubakiActor } from "./tsubakiActor.ts";

// 殻の部品。自分で actor.ts を書く drop が、同じ言葉で view を組みたいとき用。
export { allowProp, toPreact } from "./vnode.ts";
export type { Action, VNode, ViewPolicy } from "./vnode.ts";
export { classOf, declarations, isNested, makeSheet, printStyle, rule } from "./style.ts";
export type { Sheet, StyleData } from "./style.ts";
export { COMMANDS } from "./commands.ts";
