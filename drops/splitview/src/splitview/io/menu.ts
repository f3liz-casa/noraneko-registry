// SPDX-License-Identifier: MPL-2.0

// タブの右クリックに二行。
//
// 本体にも "Open in split view" はあるが、それは**新しい分割ビューを作る**行で、
// もう分割ビューに入っているタブでは消える(tab-context-menu.js: hasSplitViewTab)。
// 二枚が上限だったのだから、それで足りていた。三枚目・四枚目を足す口はここで開ける。
//
// 出る行は、そのとき意味のあるものだけ ── 何も起きない行が並んでいるほうが、
// 行が無いより分かりにくい(rename-tab の "Clear name" と同じ約束)。

import type { Io } from "../../_shared/io.ts";
import type { ChromeWindow, XULTab } from "../chrome.ts";
import { MAX_PANES } from "../layout.ts";

const ADD = "Add to split view";
const DROP = "Remove this pane";

export function addMenuRows(io: Io, win: ChromeWindow): void {
  const doc = win.document;
  const popup = doc.getElementById("tabContextMenu");
  if (!popup) return;
  // **末尾に置く。** 本体の分割ビューの行の隣に並べたいところだが、
  // MenuSectionLayout は「どの section も名指ししていない子」を見つけると投げる。
  // 例外は**末尾に足された一続き**だけ(open な section を持つ popup)。途中に
  // 挟むと、メニューを開くたびにエラーが console に出る ── そしてそれが溜まると、
  // console 自身の記録が再帰する(io/panels.ts の空 id の話と同じ道)
  const at = { parent: popup };

  const row = (id: string, label: string, run: (tab: XULTab) => void): Element => {
    const item = doc.createXULElement("menuitem");
    item.id = id;
    item.setAttribute("label", label);
    item.setAttribute("hidden", "true");
    io.place(item, at);
    io.listen(item, "command", () => {
      const tab = win.TabContextMenu?.contextTab;
      if (tab) run(tab);
    });
    return item;
  };

  const add = row("nora-splitview-add", ADD, (tab) => addToSplit(win, tab));
  const drop = row("nora-splitview-drop", DROP, (tab) => dropFromSplit(win, tab));

  io.listen(popup, "popupshowing", () => {
    const tab = win.TabContextMenu?.contextTab;
    show(add, !!tab && canAdd(win, tab));
    show(drop, !!tab?.splitview && tab.splitview.tabs.length > 2);
  });
}

function show(item: Element, yes: boolean): void {
  // 属性のほう。XUL で行が隠れるのはこちら
  if (yes) item.removeAttribute("hidden");
  else item.setAttribute("hidden", "true");
}

/** そのタブを足せるか。もう入っている / いっぱい / いま見ているタブ自身、では足せない */
export function canAdd(win: ChromeWindow, tab: XULTab): boolean {
  if (tab.pinned) return false;
  const active = win.gBrowser.selectedTab?.splitview;
  if (active) return tab.splitview !== active && active.tabs.length < MAX_PANES;
  return tab !== win.gBrowser.selectedTab && !tab.splitview;
}

/**
 * いま分割ビューを見ているなら、そこへ一枚足す。まだなら、いま見ているタブと
 * 二枚で始める(本体の "Open in split view" と同じ入口)。
 *
 * 本体の行は browser.tabs.splitView.enabled が false だと出ないが、この行は出す。
 * 分割ビューを二枚から四枚に開ける drop を、わざわざ入れた人が居るところなので
 * ── その pref のほうを、drop が黙って書き換えることはしない(設定は入れた人のもの)。
 */
export function addToSplit(win: ChromeWindow, tab: XULTab): void {
  const active = win.gBrowser.selectedTab?.splitview;
  if (active) {
    if (active.tabs.length >= MAX_PANES) return;
    active.addTabs([tab]);
    return;
  }
  const current = win.gBrowser.selectedTab;
  if (!current || current === tab) return;
  win.gBrowser.addTabSplitView([current, tab]);
}

/**
 * 一枚だけ、分割の外へ。タブは閉じない ── 列の、その束のすぐ後ろに戻す。
 * 本体の "Separate" は束ごと解くので、三枚のうち一枚だけ、ができない。
 * (二枚から一枚を抜くと本体が自分で束を解くので、そのときはこの行を出さない)
 */
function dropFromSplit(win: ChromeWindow, tab: XULTab): void {
  const wrapper = tab.splitview;
  if (!wrapper) return;
  win.gBrowser.handleTabMove(tab, () => {
    win.gBrowser.tabContainer.insertBefore(tab, wrapper.nextElementSibling);
  });
}
