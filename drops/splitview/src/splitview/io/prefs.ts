// SPDX-License-Identifier: MPL-2.0

// 覚えておくこと三つ。設定は about:config の pref 一本ずつで(docs/LAYERS.md)。
//
// 境は「0.5」「0.33,0.66」のようなカンマ区切りの字。JSON でないのは、これが
// 目で読めて手で直せるものでいてほしいから ── about:config で「0.5」と見えて、
// 「0.3」と書き換えれば、その場で境が動く。

import type { Edges, Layout } from "../layout.ts";
import { LAYOUTS } from "../layout.ts";

export const PREF_LAYOUT = "noraneko.splitview.layout";
export const PREF_COLS = "noraneko.splitview.cols";
export const PREF_ROWS = "noraneko.splitview.rows";

export const PREFS = [PREF_LAYOUT, PREF_COLS, PREF_ROWS];

export function heldLayout(): Layout {
  const held = Services.prefs.getStringPref(PREF_LAYOUT, "columns");
  return (LAYOUTS as string[]).includes(held) ? (held as Layout) : "columns";
}

export function holdLayout(layout: Layout): void {
  Services.prefs.setStringPref(PREF_LAYOUT, layout);
}

export function heldEdges(): Edges {
  return {
    cols: numbers(Services.prefs.getStringPref(PREF_COLS, "")),
    rows: numbers(Services.prefs.getStringPref(PREF_ROWS, "")),
  };
}

export function holdEdges(edges: Edges): void {
  Services.prefs.setStringPref(PREF_COLS, text(edges.cols));
  Services.prefs.setStringPref(PREF_ROWS, text(edges.rows));
}

/** 読めない字は無かったことに ── 手で書き換えられる場所なので、転ばないほうを選ぶ */
function numbers(held: string): number[] {
  if (held === "") return [];
  const out: number[] = [];
  for (const part of held.split(",")) {
    const value = Number.parseFloat(part);
    if (!Number.isFinite(value) || value <= 0 || value >= 1) return [];
    out.push(value);
  }
  return out;
}

function text(edges: number[]): string {
  return edges.map((edge) => edge.toFixed(4)).join(",");
}
