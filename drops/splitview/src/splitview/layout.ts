// SPDX-License-Identifier: MPL-2.0

// 決めるところ。窓も pref も DOM も知らない ── 「ペインが n 枚、並べかたはこれ、
// 境はここ」から「grid をどう組むか」と「どれをどこに置くか」を出すだけ。
//
// 本体の分割ビューは flex で、CSS は column="0" と column="1" の order しか
// 知らない。三枚目には行き場が無い。grid に替えると、置き場所は line の番号で
// 一枚ずつ言えるので、order も DOM の順も要らなくなる ── そして境が track に
// なるので、ドラッグは「その track の幅を書き換える」ことになって、動かしている
// 最中にそのまま中身がついてくる。
//
// 境は 0..1 の位置で持つ(「左から何割のところ」)。幅そのものでないのは、窓の
// 大きさが変わっても割合のままでいてほしいから。

/** 並べかた。grid は三枚以上でだけ意味を持つ(二枚の格子は横並びと同じもの) */
export type Layout = "columns" | "rows" | "grid";

export const LAYOUTS: Layout[] = ["columns", "rows", "grid"];

/** 何枚まで。本体の分割ビューは枚数を制限していないが、四枚より先は畳が小さすぎる */
export const MAX_PANES = 4;

/** 境の太さ。掴める幅であって、見える幅ではない(見えるのは真ん中の細い線) */
export const GRIP = "6px";

/** grid の中の居場所。line の番号か "1 / -1"(端から端まで) */
export interface Place {
  column: string;
  row: string;
}

/** 境ひとつ。axis はどちらの向きに動くか、index は edges の何本目か */
export interface Grip {
  axis: "col" | "row";
  index: number;
  place: Place;
}

/** 境の位置たち。列の境と行の境を別々に持つ(格子は縦一本と横一本を使う) */
export interface Edges {
  cols: number[];
  rows: number[];
}

/** その枚数で、その並べかたが実際に何になるか */
export function effective(layout: Layout, panes: number): Layout {
  if (panes < 3 && layout === "grid") return "columns";
  return layout;
}

/** その並べかたと枚数のとき、境が何本ずついるか */
export function edgeCount(layout: Layout, panes: number): { cols: number; rows: number } {
  const shape = effective(layout, panes);
  if (shape === "columns") return { cols: panes - 1, rows: 0 };
  if (shape === "rows") return { cols: 0, rows: panes - 1 };
  return { cols: 1, rows: 1 };
}

/** 何も言われていないときの境: 等分 */
export function evenEdges(layout: Layout, panes: number): Edges {
  const want = edgeCount(layout, panes);
  return { cols: even(want.cols), rows: even(want.rows) };
}

function even(count: number): number[] {
  const out: number[] = [];
  for (let i = 1; i <= count; i++) out.push(i / (count + 1));
  return out;
}

/**
 * 覚えていた境を、いまの形に合わせる。本数が違えば等分に戻す ── 二枚から四枚へ
 * 変えたときに、前の一本を引き伸ばして使うより、そのほうが素直。
 */
export function fitEdges(layout: Layout, panes: number, held: Edges): Edges {
  const want = edgeCount(layout, panes);
  const fresh = evenEdges(layout, panes);
  return {
    cols: held.cols.length === want.cols ? held.cols : fresh.cols,
    rows: held.rows.length === want.rows ? held.rows : fresh.rows,
  };
}

/** grid-template-columns / -rows。区画は fr で分ける(境の太さを引いた残りの取り合い) */
export function template(layout: Layout, panes: number, edges: Edges): { columns: string; rows: string } {
  const shape = effective(layout, panes);
  if (shape === "columns") return { columns: track(edges.cols), rows: "minmax(0, 1fr)" };
  if (shape === "rows") return { columns: "minmax(0, 1fr)", rows: track(edges.rows) };
  return { columns: track(edges.cols), rows: track(edges.rows) };
}

/**
 * 境の位置から track の並びへ。`minmax(0, Xfr)` なのは、素の `Xfr` だと中身の
 * min-content より小さくなれない ── ページが縮まるのを拒んで比が守られなくなる。
 */
function track(edges: number[]): string {
  const parts: string[] = [];
  let prev = 0;
  for (const edge of edges) {
    parts.push(fr(edge - prev), GRIP);
    prev = edge;
  }
  parts.push(fr(1 - prev));
  return parts.join(" ");
}

function fr(size: number): string {
  return `minmax(0, ${Math.max(size, 0).toFixed(4)}fr)`;
}

/** i 枚目のペインの居場所。i は本体が付ける column 属性(0 から) */
export function paneAt(layout: Layout, panes: number, i: number): Place {
  const shape = effective(layout, panes);
  if (shape === "columns") return { column: line(i), row: "1 / -1" };
  if (shape === "rows") return { column: "1 / -1", row: line(i) };
  // 格子。三枚のときは 0 枚目が左を全部もらう(主のひとつと、それに従う二つ)
  if (panes <= 3) {
    if (i === 0) return { column: "1", row: "1 / -1" };
    return { column: "3", row: line(i - 1) };
  }
  return { column: line(i % 2), row: line(Math.floor(i / 2)) };
}

/** 境たち。ペインの間に一本ずつ、格子なら縦と横に一本ずつ */
export function grips(layout: Layout, panes: number): Grip[] {
  const shape = effective(layout, panes);
  const out: Grip[] = [];
  if (shape === "columns") {
    for (let i = 0; i < panes - 1; i++) {
      out.push({ axis: "col", index: i, place: { column: gap(i), row: "1 / -1" } });
    }
    return out;
  }
  if (shape === "rows") {
    for (let i = 0; i < panes - 1; i++) {
      out.push({ axis: "row", index: i, place: { column: "1 / -1", row: gap(i) } });
    }
    return out;
  }
  out.push({ axis: "col", index: 0, place: { column: "2", row: "1 / -1" } });
  // 三枚の格子では、横の境は右の列にしかない(左のペインは上下に割れていない)
  out.push({ axis: "row", index: 0, place: { column: panes <= 3 ? "3" : "1 / -1", row: "2" } });
  return out;
}

/** i 番目の区画が始まる line。区画と境が交互なので、一つ飛ばしに数える */
function line(i: number): string {
  return String(i * 2 + 1);
}

/** i 番目の境の line */
function gap(i: number): string {
  return String(i * 2 + 2);
}

/** 掴んだ境を、掴んだところへ。両隣の境より近づきすぎないように止める */
export function moveEdge(edges: number[], index: number, to: number): number[] {
  const least = 0.08;
  const low = (edges[index - 1] ?? 0) + least;
  const high = (edges[index + 1] ?? 1) - least;
  const next = [...edges];
  next[index] = Math.min(Math.max(to, low), high);
  return next;
}
