// SPDX-License-Identifier: MPL-2.0

// ペインとペインの境。掴んで動かすと、動かしている最中に中身がついてくる。
//
// 本体の <splitter> は「DOM の前の兄弟の width 属性を書き換える」仕組みで、grid に
// 置き換えた並びとは噛み合わない(隣が誰かは line の番号が決めていて、兄弟の順では
// なくなっている)。だから境はこちらで持つ。やることは pointermove のたびに
// grid-template を書き換えるだけなので、追随は素直に起きる ── 離したときに初めて
// 形が変わる、にはならない。
//
// pointer は capture する。境を掴んだまま速く動かすと、pointer はすぐページの上に
// 出てしまい、その中は別のプロセスなので、capture していないと二度と戻ってこない。

import type { Io } from "../../_shared/io.ts";
import type { ChromeWindow } from "../chrome.ts";
import type { Edges } from "../layout.ts";
import { MAX_PANES, grips as gripsOf, moveEdge } from "../layout.ts";
import type { PanelGrid } from "./panels.ts";
import { holdEdges } from "./prefs.ts";

export interface Grips {
  /** 形が変わった: 境を、いまの形のところへ */
  update(): void;
}

const ATTR_DRAGGING = "nora-split-dragging";

export function makeGrips(io: Io, win: ChromeWindow, grid: PanelGrid): Grips {
  const tabpanels = win.gBrowser.tabpanels;
  if (!tabpanels) throw new Error("[splitview] gBrowser.tabpanels が無い");

  // 境は作り直さず、使い回す。四枚を横に並べたときの三本が上限で、格子は二本
  // (縦と横)。作り直すと、掴んでいる最中に手の下から消えることがある。
  const bars: HTMLElement[] = [];
  for (let i = 0; i < MAX_PANES - 1; i++) {
    const bar = win.document.createXULElement("hbox") as unknown as HTMLElement;
    bar.className = "nora-split-grip";
    bar.hidden = true;
    io.place(bar, { parent: tabpanels });
    listen(io, win, grid, bar);
    bars.push(bar);
  }

  return {
    update(): void {
      const now = grid.now();
      const wanted = now ? gripsOf(now.layout, now.panes) : [];
      for (const [i, bar] of bars.entries()) {
        const want = wanted[i];
        if (!want) {
          bar.hidden = true;
          continue;
        }
        bar.hidden = false;
        bar.dataset.axis = want.axis;
        bar.dataset.index = String(want.index);
        bar.style.setProperty("grid-column", want.place.column);
        bar.style.setProperty("grid-row", want.place.row);
      }
    },
  };
}

function listen(io: Io, win: ChromeWindow, grid: PanelGrid, bar: HTMLElement): void {
  let held: Edges | null = null;

  io.listen(bar, "pointerdown", (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    const now = grid.now();
    if (!now) return;
    ev.preventDefault();
    held = now.edges;
    // 掴んでいる間、ページは手を出さない。捕まえていても、ページの上を通ると
    // カーソルがそちらの言うなりになる(境を持っているのに I ビームになる)
    win.gBrowser.tabpanels?.setAttribute(ATTR_DRAGGING, "true");
    try {
      bar.setPointerCapture(ev.pointerId);
    } catch {
      // 捕まえられなくても動く(手がページの上に出たところで途切れるだけ)。
      // ここで止まって、掴んだことまで無かったことになるほうが困る
    }
  });

  io.listen(bar, "pointermove", (ev: PointerEvent) => {
    if (!held) return;
    const box = grid.box();
    if (!box) return;
    const axis = bar.dataset.axis === "row" ? "row" : "col";
    const index = Number(bar.dataset.index ?? 0);
    const to = axis === "col"
      ? (ev.clientX - box.left) / box.width
      : (ev.clientY - box.top) / box.height;
    held = axis === "col"
      ? { ...held, cols: moveEdge(held.cols, index, to) }
      : { ...held, rows: moveEdge(held.rows, index, to) };
    grid.slide(held);
  });

  const done = (ev: PointerEvent): void => {
    if (!held) return;
    if (bar.hasPointerCapture(ev.pointerId)) bar.releasePointerCapture(ev.pointerId);
    win.gBrowser.tabpanels?.removeAttribute(ATTR_DRAGGING);
    holdEdges(held);
    held = null;
  };
  io.listen(bar, "pointerup", done);
  io.listen(bar, "pointercancel", done);

  // キーでも動かせる。境は tabindex を持っていて、Tab で辿り着ける
  io.listen(bar, "keydown", (ev: KeyboardEvent) => {
    const now = grid.now();
    if (!now) return;
    const axis = bar.dataset.axis === "row" ? "row" : "col";
    const index = Number(bar.dataset.index ?? 0);
    const step = ev.key === "ArrowLeft" || ev.key === "ArrowUp"
      ? -0.02
      : ev.key === "ArrowRight" || ev.key === "ArrowDown"
      ? 0.02
      : 0;
    if (step === 0) return;
    ev.preventDefault();
    const from = axis === "col" ? now.edges.cols : now.edges.rows;
    const to = (from[index] ?? 0.5) + step;
    const next = axis === "col"
      ? { ...now.edges, cols: moveEdge(now.edges.cols, index, to) }
      : { ...now.edges, rows: moveEdge(now.edges.rows, index, to) };
    grid.slide(next);
    holdEdges(next);
  });
}
