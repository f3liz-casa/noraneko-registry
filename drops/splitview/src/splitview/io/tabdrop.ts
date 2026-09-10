// SPDX-License-Identifier: MPL-2.0

// タブを掴んで、ページの上に落とすと、そこが分割になる。
//
// 落とした場所は「どちら向きに並べるか」を決める ── 左右の端なら横に、上下の端
// なら縦に。落とす前に、そうなったらどう見えるかを薄い矩形で先に出す(落として
// から驚くより、落とす前に分かるほうがいい)。
//
// タブの引きずりは Firefox の内部の D&D で、"application/x-moz-tabbrowser-tab" に
// タブそのものが載っている。dropEffect を "move" にして受け取ると、本体のタブ側は
// 「どこかが受け取った」と見て、新しい窓を作る道に入らない ── タブ列の外に落とすと
// 窓になる、という既にある動きと、ここで喧嘩しないで済む。

import type { Io } from "../../_shared/io.ts";
import type { ChromeWindow, XULTab } from "../chrome.ts";
import { MAX_PANES } from "../layout.ts";
import type { PanelGrid } from "./panels.ts";
import { addToSplit, canAdd } from "./menu.ts";
import { holdLayout } from "./prefs.ts";

const TAB_FLAVOR = "application/x-moz-tabbrowser-tab";

interface TabTransfer extends DataTransfer {
  mozGetDataAt(flavor: string, index: number): unknown;
}

export function makeTabDrop(io: Io, win: ChromeWindow, grid: PanelGrid): void {
  const tabpanels = win.gBrowser.tabpanels;
  if (!tabpanels) return;

  // 予告の矩形。ページの上に浮くので、自分は当たり判定を持たない
  const hint = win.document.createXULElement("box") as unknown as HTMLElement;
  hint.className = "nora-split-hint";
  hint.hidden = true;
  io.place(hint, { parent: tabpanels });

  const hide = (): void => {
    hint.hidden = true;
  };

  // capture で受ける。ページの中(別のプロセス)まで降りてしまうと、こちらには
  // 二度と来ない
  io.listen(tabpanels, "dragover", (ev: DragEvent) => {
    const tab = dragged(win, ev);
    if (!tab) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
    const box = grid.box();
    if (!box) return;
    const side = sideOf(box, ev.clientX, ev.clientY);
    const panes = (grid.now()?.panes ?? 1) + 1;
    place(hint, side, panes);
    hint.hidden = false;
  }, true);

  io.listen(tabpanels, "dragleave", (ev: DragEvent) => {
    // 中の要素へ移っただけの dragleave は無視する(出たり入ったりで点滅する)
    const to = ev.relatedTarget as Node | null;
    if (to && tabpanels.contains(to)) return;
    hide();
  }, true);

  io.listen(tabpanels, "drop", (ev: DragEvent) => {
    const tab = dragged(win, ev);
    hide();
    if (!tab) return;
    ev.preventDefault();
    ev.stopPropagation();
    const box = grid.box();
    if (box) holdLayout(sideOf(box, ev.clientX, ev.clientY) === "block" ? "rows" : "columns");
    addToSplit(win, tab);
  }, true);

  io.listen(tabpanels, "dragend", hide, true);
}

/**
 * 引きずられているのが、この窓のタブで、いま足せるものなら、そのタブ。
 * ほかの窓から来たタブは本体の作法(adoptTab)が要るので、ここでは受けない。
 */
function dragged(win: ChromeWindow, ev: DragEvent): XULTab | null {
  const dt = ev.dataTransfer as TabTransfer | null;
  if (!dt || !Array.from(dt.types).includes(TAB_FLAVOR)) return null;
  const tab = dt.mozGetDataAt(TAB_FLAVOR, 0) as XULTab | null;
  if (!tab || tab.ownerDocument !== win.document) return null;
  const now = win.gBrowser.selectedTab?.splitview;
  if (now && now.tabs.length >= MAX_PANES) return null;
  return canAdd(win, tab) ? tab : null;
}

/** 掴んでいる手が、どちらの端に寄っているか。inline = 左右、block = 上下 */
function sideOf(box: DOMRect, x: number, y: number): "inline" | "block" {
  const across = Math.min(x - box.left, box.right - x) / box.width;
  const down = Math.min(y - box.top, box.bottom - y) / box.height;
  return down < across ? "block" : "inline";
}

/** 予告の矩形を、足したあとにその一枚が座る場所へ */
function place(hint: HTMLElement, side: "inline" | "block", panes: number): void {
  const share = `${(100 / panes).toFixed(2)}%`;
  const along = side === "inline";
  hint.style.setProperty("inset-inline", along ? `auto 0` : "0");
  hint.style.setProperty("inset-block", along ? "0" : `auto 0`);
  hint.style.setProperty("width", along ? share : "auto");
  hint.style.setProperty("height", along ? "auto" : share);
}
