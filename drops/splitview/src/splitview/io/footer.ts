// SPDX-License-Identifier: MPL-2.0

// ペインの隅に、二つ。
//
// 本体はもう footer を持っている ── 分割ビューで「いま見ていないほう」のペインの
// 隅に、favicon とドメインと「…」が出る。足りないのは、そこから直接できることで、
// 「…」を開いてメニューから探すことになる。よく要るのは二つだけなので、隣に置く:
//
//   ひとりにする  そのペインだけを見る(分割を解いて、そのタブへ)
//   閉じる        そのタブを閉じる(二枚なら、本体が自分で分割を解く)
//
// 出るのはカーソルがそのペインに来たときだけ。ずっと見えていると、ページの隅に
// 常に何かが乗っていることになる。
//
// 本体の footer は「見ていないほう」にしか出ないので、見ているペインのぶんは
// CSS で hover のときだけ出す(style.ts)。

import type { Io } from "../../_shared/io.ts";
import type { ChromeWindow, XULTab } from "../chrome.ts";
import type { PanelGrid } from "./panels.ts";

export interface Footers {
  update(): void;
}

const ALONE = "chrome://browser/skin/fullscreen.svg";
const CLOSE = "chrome://global/skin/icons/close.svg";

export function makeFooters(io: Io, win: ChromeWindow, grid: PanelGrid): Footers {
  return {
    update(): void {
      for (const pane of grid.panes()) {
        const footer = pane.querySelector("split-view-footer");
        if (!footer || footer.querySelector(".nora-split-act")) continue;
        // 本体の「…」の手前に。並びは 閉じる のほうが端に来ないようにする
        const more = footer.querySelector("toolbarbutton");
        const at = more ? { before: more } : { parent: footer };
        add(io, win, pane, at, ALONE, "Show only this pane", (tab) => alone(win, tab));
        add(io, win, pane, at, CLOSE, "Close this pane", (tab) => win.gBrowser.removeTab(tab));
      }
    },
  };
}

function add(
  io: Io,
  win: ChromeWindow,
  pane: Element,
  at: { before: Node } | { parent: Node },
  icon: string,
  tip: string,
  run: (tab: XULTab) => void,
): void {
  const button = win.document.createXULElement("toolbarbutton");
  button.className = "nora-split-act";
  button.setAttribute("image", icon);
  button.setAttribute("tooltiptext", tip);
  io.place(button, at);
  io.listen(button, "command", (ev: Event) => {
    // footer は click を止めるが、これは footer の中で起きるので自分で止める
    // (押した拍子にそのペインへ移ってしまうと、閉じたのがどれか分からなくなる)
    ev.stopPropagation();
    // タブは押されたときに引く。ペインの中身は入れ替わることがある
    const tab = tabOf(win, pane.id);
    if (tab) run(tab);
  });
}

/** その箱に紐づいているタブ。panel の id は、そのタブの linkedPanel */
function tabOf(win: ChromeWindow, panelId: string): XULTab | null {
  for (const tab of win.gBrowser.tabs) {
    if (tab.linkedPanel === panelId) return tab;
  }
  return null;
}

/** そのペインだけを見る。分割は解けて、ほかのタブは普通のタブとして残る */
function alone(win: ChromeWindow, tab: XULTab): void {
  const wrapper = tab.splitview;
  if (!wrapper) return;
  wrapper.unsplitTabs("nora_alone");
  win.gBrowser.selectedTab = tab;
}
