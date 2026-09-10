// SPDX-License-Identifier: MPL-2.0

// 芯。#tabbrowser-tabpanels の中を、flex から grid にする。
//
// 本体は分割ビューのペインを flex で横に並べ、CSS が column="0" と column="1" の
// order だけを知っている。三枚目は行き場が無く、縦にも格子にもならない。
// grid にすると置き場所を一枚ずつ line の番号で言えるので、order も DOM の順も
// 要らなくなる。
//
// 掴むところは一つだけ ── MozTabpanels の `setSplitViewActive`。本体は分割ビューが
// 動くたび(タブを足す、選び替える、別のタブへ移る、外す)ここを必ず通るので、
// ここの後ろに並べ直しを足すだけで、ほかの道を塞がずに済む。包むのは prototype
// ではなく **その窓の tabpanels ひとつ**なので、外せば delete 一つで元に戻る。
//
// 本体の splitter は隠す(grid では兄弟の幅を動かす仕組みが噛み合わない)。
// 代わりの境は io/grips.ts が置く。

import type { Io } from "../../_shared/io.ts";
import type { ChromeWindow, Tabpanels } from "../chrome.ts";
import type { Edges, Layout } from "../layout.ts";
import { effective, fitEdges, paneAt, template } from "../layout.ts";
import { heldEdges, heldLayout } from "./prefs.ts";

/** いま窓に出ている分割ビューの形 */
export interface Grid {
  layout: Layout;
  panes: number;
  edges: Edges;
}

export interface PanelGrid {
  /** いまの形。分割ビューが出ていなければ null */
  now(): Grid | null;
  /** pref を読み直して並べ直す */
  arrange(): void;
  /** ドラッグの最中: 境だけ書き換える(pref には触らない) */
  slide(edges: Edges): void;
  /** ペインの箱たち(左上から) */
  panes(): HTMLElement[];
  /** 格子の外枠。境を掴んだ位置を割合に直すのに使う */
  box(): DOMRect | null;
}

const ATTR_LAYOUT = "nora-split";
const ATTR_PANES = "nora-split-panes";
/**
 * タブを掴んでいる間、分割ビューを出したままにしている印(io/tabdrop.ts)。
 * そのとき選ばれているのは掴んだタブ ── 分割の外のタブ ── なので、
 * 「いま分割ビューを見ているか」を選択だけで決めると、格子が解けてしまう。
 */
export const ATTR_HELD = "nora-split-held";

/**
 * 掴んでいる間、そのまま置いておく panel(分割ビューを見ていなかったとき)。
 * 印は panel のほうに付く ── 見せたいのは、選択が移ったあとの「前の一枚」なので。
 */
export const ATTR_PEEK = "nora-split-peek";

export function makeGrid(io: Io, win: ChromeWindow, onChange: (grid: Grid | null) => void): PanelGrid {
  const tabpanels = win.gBrowser.tabpanels;
  if (!tabpanels) throw new Error("[splitview] gBrowser.tabpanels が無い");

  let held: Grid | null = null;
  // この drop が置き場所を書いた箱たち。分割ビューから外れた panel は
  // splitViewPanels から消えるので、そのとき誰も掃除しなくなる ── 覚えておく。
  const touched = new Set<HTMLElement>();

  const panes = (): HTMLElement[] => {
    const out: HTMLElement[] = [];
    for (const id of tabpanels.splitViewPanels) {
      const el = win.document.getElementById(id);
      if (el) out.push(el);
    }
    return out;
  };

  const arrange = (): void => {
    const found = panes();
    // 分割ビューを見ていないとき(別のタブに移った、二枚に満たない)は手を引く。
    // 本体の flex がそのまま効く形に戻しておく ── 掛けっぱなしの grid で、
    // 見ていない間に何かが起きるほうが怖い。
    const showing = tabpanels.hasAttribute("splitview") &&
      (!!win.gBrowser.selectedTab?.splitview || tabpanels.hasAttribute(ATTR_HELD));
    if (!showing || found.length < 2) {
      strip();
      held = null;
      onChange(null);
      return;
    }

    const layout = effective(heldLayout(), found.length);
    const edges = fitEdges(layout, found.length, heldEdges());
    held = { layout, panes: found.length, edges };

    tabpanels.setAttribute(ATTR_LAYOUT, layout);
    tabpanels.setAttribute(ATTR_PANES, String(found.length));
    slide(edges);
    for (const pane of touched) {
      if (!found.includes(pane)) unplace(pane);
    }
    for (const [i, pane] of found.entries()) {
      const place = paneAt(layout, found.length, i);
      pane.style.setProperty("grid-column", place.column);
      pane.style.setProperty("grid-row", place.row);
      touched.add(pane);
    }
    onChange(held);
  };

  const slide = (edges: Edges): void => {
    if (!held) return;
    held = { ...held, edges };
    const tracks = template(held.layout, held.panes, edges);
    tabpanels.style.setProperty("grid-template-columns", tracks.columns);
    tabpanels.style.setProperty("grid-template-rows", tracks.rows);
  };

  // 本体が分割ビューを動かしたあとに、並べ直す。元の仕事は先に済ませてもらう
  // (splitter の hidden、DOM の順、selectedPanel の付け直しが、そこで起きる)。
  const proto = Object.getPrototypeOf(tabpanels) as Tabpanels;
  const original = proto.setSplitViewActive;
  Object.defineProperty(tabpanels, "setSplitViewActive", {
    configurable: true,
    writable: true,
    value: function (this: Tabpanels, active: boolean): void {
      original.call(this, active);
      arrange();
    },
  });
  io.defer(() => {
    delete (tabpanels as unknown as Record<string, unknown>).setSplitViewActive;
    strip();
  });

  /** 置いたものを、置く前の姿へ */
  function strip(): void {
    tabpanels.removeAttribute(ATTR_LAYOUT);
    tabpanels.removeAttribute(ATTR_PANES);
    tabpanels.removeAttribute(ATTR_HELD);
    tabpanels.style.removeProperty("grid-template-columns");
    tabpanels.style.removeProperty("grid-template-rows");
    for (const pane of touched) unplace(pane);
    touched.clear();
  }

  return {
    now: () => held,
    arrange,
    slide,
    panes,
    box: () => tabpanels.getBoundingClientRect(),
  };
}

function unplace(pane: HTMLElement): void {
  pane.style.removeProperty("grid-column");
  pane.style.removeProperty("grid-row");
}
