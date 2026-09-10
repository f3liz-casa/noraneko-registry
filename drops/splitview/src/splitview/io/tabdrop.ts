// SPDX-License-Identifier: MPL-2.0

// タブを掴んで、分割ビューの束の上に落とすと、そこに足される。
//
// 最初はページの上に落とす形にしていた(Vivaldi のあれ)。それは**できない**。
// タブは掴んだ瞬間に選ばれるので、落とす先のページはもう掴んだタブ自身に
// なっていて、分割ビューのほうは「分割の外のタブが選ばれた」として畳まれている
// (tabsplitview.js の #suspend)。落とす場所そのものが、掴んだ時点で無い。
//
// なので落とす先はタブの列のほう ── 分割ビューのタブたちを束ねている
// <tab-split-view-wrapper> の上。掴んだタブが前に出ていても、束は列にそのまま
// 居るので関係ない。束が無ければ何も起きないので、ふつうの並べ替えの邪魔にも
// ならない(束の隣に置きたいなら、束の外に落とす)。
//
// タブの引きずりは Firefox の内部の D&D で、"application/x-moz-tabbrowser-tab" に
// タブそのものが載っている。

import type { Io } from "../../_shared/io.ts";
import type { ChromeWindow, SplitViewWrapper, XULTab } from "../chrome.ts";
import { MAX_PANES } from "../layout.ts";

const TAB_FLAVOR = "application/x-moz-tabbrowser-tab";
const ATTR_TARGET = "nora-split-target";

interface TabTransfer extends DataTransfer {
  mozGetDataAt(flavor: string, index: number): unknown;
}

export function makeTabDrop(io: Io, win: ChromeWindow): void {
  const strip = win.gBrowser.tabContainer;
  let lit: Element | null = null;

  const light = (wrapper: Element | null): void => {
    if (lit === wrapper) return;
    lit?.removeAttribute(ATTR_TARGET);
    wrapper?.setAttribute(ATTR_TARGET, "true");
    lit = wrapper;
  };
  io.defer(() => light(null));

  // capture で受ける。本体のタブの並べ替えが先に手を出す前に、束の上かどうかを
  // 見て、そこだけ引き取る
  io.listen(strip, "dragover", (ev: DragEvent) => {
    const found = target(win, ev);
    light(found?.wrapper ?? null);
    if (!found) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
  }, true);

  io.listen(strip, "drop", (ev: DragEvent) => {
    const found = target(win, ev);
    light(null);
    if (!found) return;
    ev.preventDefault();
    ev.stopPropagation();
    found.wrapper.addTabs([found.tab]);
    win.gBrowser.selectedTab = found.tab;
  }, true);

  const done = (): void => light(null);
  io.listen(strip, "dragleave", done, true);
  io.listen(strip, "dragend", done, true);
}

/** 落とせる先と、落とされているタブ。どちらか欠けたら null */
function target(win: ChromeWindow, ev: DragEvent): { wrapper: SplitViewWrapper; tab: XULTab } | null {
  const dt = ev.dataTransfer as TabTransfer | null;
  if (!dt || !Array.from(dt.types).includes(TAB_FLAVOR)) return null;
  const over = ev.target as Element | null;
  const wrapper = over?.closest?.("tab-split-view-wrapper") as SplitViewWrapper | null;
  if (!wrapper || wrapper.tabs.length >= MAX_PANES) return null;
  const tab = dt.mozGetDataAt(TAB_FLAVOR, 0) as XULTab | null;
  // ほかの窓から来たタブは本体の作法(adoptTab)が要るので、ここでは受けない
  if (!tab || tab.ownerDocument !== win.document) return null;
  if (tab.pinned || tab.splitview === wrapper) return null;
  return { wrapper, tab };
}
