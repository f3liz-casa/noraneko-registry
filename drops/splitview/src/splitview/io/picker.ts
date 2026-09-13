// SPDX-License-Identifier: MPL-2.0

// 並べかたを、字ではなく絵で選ぶ ── Windows のスナップレイアウトの、あの格子。
// 「横に並べる / 縦に並べる / 格子」の三つが、いまの枚数で実際どう見えるかを
// そのまま小さく描く(三枚の格子は、左が一枚と右が上下二枚)。
//
// 置き場所は本体の #split-view-menu。ペインの隅の「…」と、URL バーの分割ビューの
// アイコンが、どちらもここを開く ── 並べかたを変えたくなる場所は、もうそこにある。
//
// 絵の中の位置は、本物の grid とは別に数える。本物には境の track が挟まって
// いるが、絵にはそれが無い(gap で足りる)ので、番号がひとつずつずれる。

import type { Io } from "../../_shared/io.ts";
import type { ChromeWindow } from "../chrome.ts";
import type { Layout } from "../layout.ts";
import { LAYOUTS, effective } from "../layout.ts";
import type { PanelGrid } from "./panels.ts";
import { heldLayout, holdLayout } from "./prefs.ts";

export interface Picker {
  update(): void;
}

const NAMES: Record<Layout, string> = {
  columns: "Side by side",
  rows: "Stacked",
  grid: "Grid",
};

export function makePicker(io: Io, win: ChromeWindow, grid: PanelGrid): Picker {
  const doc = win.document;
  const menu = doc.getElementById("split-view-menu");
  if (!menu) return { update: () => {} };

  const strip = doc.createXULElement("hbox");
  strip.className = "nora-split-picker";
  const shapes: HTMLElement[] = [];
  for (const layout of LAYOUTS) {
    const button = doc.createXULElement("toolbarbutton") as unknown as HTMLElement;
    button.className = "nora-split-shape";
    button.dataset.layout = layout;
    button.setAttribute("tooltiptext", NAMES[layout]);
    const art = doc.createXULElement("box");
    art.className = "nora-split-shape-art";
    button.appendChild(art);
    strip.appendChild(button);
    shapes.push(button);
    io.listen(button, "command", () => {
      holdLayout(layout);
      update();
    });
  }
  const line = doc.createXULElement("menuseparator");
  line.className = "nora-split-picker-line";

  // メニューのいちばん上。「解く」「入れ替える」より先に、まず形の話
  const first = menu.firstElementChild;
  const at = first ? { before: first } : { parent: menu };
  io.place(strip, at);
  io.place(line, at);

  const update = (): void => {
    const now = grid.now();
    const panes = now?.panes ?? 2;
    const chosen = heldLayout();
    for (const button of shapes) {
      const layout = (button.dataset.layout ?? "columns") as Layout;
      // 二枚のときの「格子」は横並びと同じもの。選べる顔をしていないほうが正直
      const same = effective(layout, panes) === layout;
      button.hidden = !same;
      if (chosen === layout) button.setAttribute("selected", "true");
      else button.removeAttribute("selected");
      draw(win, button.firstElementChild as HTMLElement, layout, panes);
    }
  };
  io.listen(menu, "popupshowing", () => update());
  update();
  return { update };
}

/** その並べかたが、いまの枚数でどう見えるか。小さな箱の並び */
function draw(win: ChromeWindow, art: HTMLElement, layout: Layout, panes: number): void {
  const shape = effective(layout, panes);
  art.textContent = "";
  art.style.setProperty("grid-template-columns", shape === "columns" ? cells(panes) : shape === "rows" ? "1fr" : "1fr 1fr");
  art.style.setProperty("grid-template-rows", shape === "rows" ? cells(panes) : shape === "columns" ? "1fr" : "1fr 1fr");
  for (let i = 0; i < panes; i++) {
    const cell = win.document.createXULElement("box") as unknown as HTMLElement;
    cell.className = "nora-split-shape-cell";
    const place = spot(shape, panes, i);
    cell.style.setProperty("grid-column", place.column);
    cell.style.setProperty("grid-row", place.row);
    art.appendChild(cell);
  }
}

function cells(panes: number): string {
  return `repeat(${panes}, 1fr)`;
}

/** 絵の中の i 枚目。境の track が無いぶん、本物より番号が詰まっている */
function spot(shape: Layout, panes: number, i: number): { column: string; row: string } {
  if (shape === "columns") return { column: String(i + 1), row: "1 / -1" };
  if (shape === "rows") return { column: "1 / -1", row: String(i + 1) };
  if (panes <= 3) {
    if (i === 0) return { column: "1", row: "1 / -1" };
    return { column: "2", row: String(i) };
  }
  return { column: String((i % 2) + 1), row: String(Math.floor(i / 2) + 1) };
}
