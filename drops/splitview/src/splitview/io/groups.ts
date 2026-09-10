// SPDX-License-Identifier: MPL-2.0

// タブグループとの、二つの繋がり。
//
// 本体は「分割ビューをグループに入れる」をもう持っている(タブの右クリックの
// "Move split view to new group"、gBrowser.moveSplitViewToExistingGroup)。
// 無いのは**逆**で、すでにあるグループを、そのまま分割ビューにする口。
// 開いた四つのタブを並べて見たい、はグループがいちばん近いところに居るので、
// グループを編むあのパネルに一行足す。
//
// もう一つは見た目のほう。分割ビューがグループの中にあるなら、境と縁を、その
// グループの色にする ── どのグループを見ているのかが、タブの列を見上げなくても
// 分かる。色は tab-group 要素に --tab-group-color として載っているので、
// 解決済みの値を写すだけ。

import type { Io } from "../../_shared/io.ts";
import type { ChromeWindow, TabGroup, TabGroupEditor } from "../chrome.ts";
import { MAX_PANES } from "../layout.ts";

export interface Groups {
  /** 形が変わった: いま見ている分割ビューのグループの色を、写す */
  update(): void;
}

const OPEN = "Open in split view";
const TINT = "--nora-split-tint";

export function makeGroups(io: Io, win: ChromeWindow): Groups {
  addEditorRow(io, win);

  const tabpanels = win.gBrowser.tabpanels;
  io.defer(() => tabpanels?.style.removeProperty(TINT));

  return {
    update(): void {
      if (!tabpanels) return;
      const group = win.gBrowser.selectedTab?.splitview?.group ?? null;
      const tint = group ? win.getComputedStyle(group).getPropertyValue("--tab-group-color") : "";
      if (tint) tabpanels.style.setProperty(TINT, tint);
      else tabpanels.style.removeProperty(TINT);
    },
  };
}

/** グループを編むパネルの、"Ungroup tabs" の手前に一行 */
function addEditorRow(io: Io, win: ChromeWindow): void {
  const doc = win.document;
  const editor = doc.getElementById("tab-group-editor") as TabGroupEditor | null;
  if (!editor) return;
  const before = doc.getElementById("tabGroupEditor_ungroupTabs");
  const row = doc.createXULElement("toolbarbutton");
  row.id = "nora-splitview-group";
  row.className = "subviewbutton";
  row.setAttribute("tabindex", "0");
  row.setAttribute("label", OPEN);
  row.setAttribute("hidden", "true");
  io.place(row, before && before.parentNode ? { before } : { parent: editor });

  io.listen(row, "command", () => {
    const group = editor.activeGroup;
    editor.querySelector("panel")?.hidePopup();
    if (group) split(win, group);
  });

  // パネルは名前を作るときにも編むときにも開く。行が意味を持つのは、そのグループに
  // まだ分割になっていないタブが二枚以上あるときだけ
  io.listen(editor, "popupshowing", () => {
    const ready = editor.activeGroup ? free(editor.activeGroup).length >= 2 : false;
    if (ready) row.removeAttribute("hidden");
    else row.setAttribute("hidden", "true");
  });
}

/** そのグループの、まだ分割に入っていないタブたち */
function free(group: TabGroup) {
  return group.tabs.filter((tab) => !tab.pinned && !tab.splitview);
}

/**
 * グループのタブを分割ビューに。四枚を超えるグループなら、先頭の四枚まで
 * (残りはグループの中にそのまま居る ── 勝手に閉じたり、外に出したりはしない)。
 *
 * 束は tabContainer の直下に作られるので、作ってからグループへ戻す。本体の
 * moveSplitViewToExistingGroup が、そのときの後始末まで見てくれる。
 */
function split(win: ChromeWindow, group: TabGroup): void {
  const tabs = free(group).slice(0, MAX_PANES);
  if (tabs.length < 2) return;
  const wrapper = win.gBrowser.addTabSplitView(tabs);
  if (!wrapper) return;
  win.gBrowser.moveSplitViewToExistingGroup(wrapper, group);
  win.gBrowser.selectedTab = tabs[0];
}
