// SPDX-License-Identifier: MPL-2.0

// タブを掴んで落とす。二つの落とし先がある。
//
// **タブの列の束の上** ── その分割ビューに足される。
//
// **ページの上**(Vivaldi のあれ) ── 真ん中なら新しい窓、端なら、その向きで並ぶ。
//
// 二つ目には、先に気づいておくことがある: **タブは掴んだ瞬間に選ばれる**。
// だから落とす先のページはもう掴んだタブ自身になっていて、分割ビューのほうは
// 「分割の外のタブが選ばれた」として畳まれている(tabsplitview.js の #suspend)。
// つまり「いま見ているものの隣に置く」とは書けない ── 見ているのは、掴んだ
// タブなので。
//
// なので**掴む前に見ていたもの**を覚えておく(TabSelect の previousTab)。
// 相手はそれ。掴んだタブが前に出るのは、むしろ落とし先の絵を大きく描ける
// ということでもあるので、どこに入るかは矩形で先に出す。

import type { Io } from "../../_shared/io.ts";
import type { ChromeWindow, SplitViewWrapper, XULTab } from "../chrome.ts";
import { MAX_PANES } from "../layout.ts";
import { ATTR_HELD, ATTR_PEEK, type PanelGrid } from "./panels.ts";
import { holdLayout } from "./prefs.ts";

const TAB_FLAVOR = "application/x-moz-tabbrowser-tab";
const ATTR_TARGET = "nora-split-target";
/** 真ん中の、この割合が「新しい窓」。外側は、いちばん近い端 */
const MIDDLE = 0.4;

type Zone = "window" | "start" | "end" | "top" | "bottom";

interface TabTransfer extends DataTransfer {
  mozGetDataAt(flavor: string, index: number): unknown;
}

export function makeTabDrop(io: Io, win: ChromeWindow, grid: PanelGrid): void {
  // 掴む前に見ていたタブ。掴んだ時点で選択はもう移っているので、こちらで覚える
  let before: XULTab | null = null;
  io.listen(win.gBrowser.tabContainer, "TabSelect", (ev: CustomEvent) => {
    const prev = ev.detail?.previousTab as XULTab | undefined;
    if (prev?.parentNode) before = prev;
  });

  const grip = hold(io, win, grid, () => before);
  stripDrop(io, win);
  // 相手は hold が押した時点で覚えたもの。ここで別に決めると、二つがずれた
  // ときに「相手が居ない」= 新しい窓、に落ちる
  pageDrop(io, win, grip.partner);
  // 後始末は、落とす処理より**後ろ**に。どちらも capture で受けていて、先に走ると
  // 「まだ分割に入っていない」と見て一度畳んでしまう(落とした瞬間にちらつく)
  io.listen(win.gBrowser.tabpanels!, "drop", grip.stop, true);
  io.listen(win.gBrowser.tabContainer, "drop", grip.stop, true);
}

// --- 掴んでいる間、分割ビューを出したままにする -------------------------------

/**
 * Vivaldi 式が Vivaldi 式であるためには、これが要る。
 *
 * タブを掴むとそのタブが選ばれ、本体は「分割の外のタブへ移った」として分割ビューを
 * 畳む(tabsplitview.js の #suspend)。すると画面に出ているのは掴んだタブのページ
 * だけで、その上に「ここに入る」と描いても、下に何も無いのだから絵が嘘になる。
 * **落とす先が見えていないと、選べない。**
 *
 * 塞ぐのは `dragstart` ではなく `mousedown`。dragstart は数ピクセル動かしてから
 * 来るので、そこで出し直しても「一度畳んでから戻す」ことにしかならず、切り替わりが
 * そのまま見えてしまう。畳まれるのは押した瞬間の TabSelect なので、それより前に
 * 立つ必要がある。
 *
 * そして畳む口そのもの ── tabpanels.suspendSplitViewPanels ── を、その間だけ
 * 塞ぐ。出し直すのではなく、はじめから畳ませない。
 *
 * 押しただけ(掴まなかった)なら、離した時点で本来の姿へ。掴んだなら、落とすまで
 * 出たまま ── そのタブが分割に入れば本体がそのまま続け、入らなかったなら、本来
 * そうなるはずだった畳んだ姿に戻す。
 *
 * 分割ビューを見ていないときも、同じ話が要る。about:support を見ていて
 * about:robots を掴んだら、掴んでいる間そこに居てほしいのは support のほう ──
 * そうでないと「右に落としたら二枚になる」の右と左が、落とすまで分からない。
 * 畳む口は関係ないので、こちらは見ていた panel に印をつけて、CSS でそのまま
 * 置いておく(掴んだタブのページは、どちらの場合も隠す)。
 */
function hold(
  io: Io,
  win: ChromeWindow,
  grid: PanelGrid,
  before: () => XULTab | null,
): { stop: () => void; partner: () => XULTab | null } {
  const tabpanels = win.gBrowser.tabpanels;
  if (!tabpanels) return { stop: () => {}, partner: () => null };
  let armed: SplitViewWrapper | null = null;
  /** 押した時点で見ていたタブ。落としたときの相手は、これ */
  let looking: XULTab | null = null;
  /** 分割ビューを見ていなかったとき、掴む前に見ていたページの箱 */
  let peeked: Element | null = null;
  let dragging = false;

  // 畳む口は一つだけ。包むのは prototype ではなく、その窓の tabpanels ひとつなので、
  // 外せば delete 一つで戻る(io/panels.ts の setSplitViewActive と同じ手)
  const proto = Object.getPrototypeOf(tabpanels) as typeof tabpanels;
  const original = proto.suspendSplitViewPanels;
  Object.defineProperty(tabpanels, "suspendSplitViewPanels", {
    configurable: true,
    writable: true,
    value: function (this: typeof tabpanels, tabs: XULTab[]): void {
      if (armed) return;
      original.call(this, tabs);
    },
  });
  io.defer(() => {
    delete (tabpanels as unknown as Record<string, unknown>).suspendSplitViewPanels;
  });

  const release = (): void => {
    if (!armed && !peeked) return;
    const wrapper = armed;
    armed = null;
    dragging = false;
    peeked?.removeAttribute(ATTR_PEEK);
    peeked = null;
    looking = null;
    tabpanels.removeAttribute(ATTR_HELD);
    // 掴んだタブが分割に入ったなら、本体がもう続きを持っている。入らなかったなら、
    // 押した時点で起きるはずだったことを、ここで起こす
    if (wrapper && !win.gBrowser.selectedTab?.splitview && wrapper.parentNode) {
      tabpanels.suspendSplitViewPanels(wrapper.tabs);
    }
    grid.arrange();
  };
  io.defer(release);

  io.listen(win.gBrowser.tabContainer, "mousedown", (ev: MouseEvent) => {
    if (ev.button !== 0) return;
    const over = ev.target as Element | null;
    if (!over?.closest?.(".tabbrowser-tab")) return;
    const showing = win.gBrowser.selectedTab;
    looking = showing ?? before() ?? null;
    const wrapper = showing?.splitview ?? before()?.splitview ?? null;
    if (wrapper?.parentNode && wrapper.tabs.length) {
      // 分割ビューを見ている: 畳ませない
      armed = wrapper;
    } else if (showing) {
      // ふつうのタブを見ている: その一枚を、掴んでいる間そのまま置いておく
      const panel = win.document.getElementById(showing.linkedPanel);
      if (!panel) return;
      panel.setAttribute(ATTR_PEEK, "true");
      peeked = panel;
    } else {
      return;
    }
    tabpanels.setAttribute(ATTR_HELD, "true");
  }, true);

  // 掴んだ ── ここから先、離すのは dragend か drop
  io.listen(win.gBrowser.tabContainer, "dragstart", () => {
    if (armed || peeked) dragging = true;
  }, true);

  // 押しただけだった。document で聞くのは、窓のどこで離してもいいように
  io.listen(win.document, "mouseup", () => {
    if (!dragging) release();
  }, true);

  const stop = (): void => {
    dragging = false;
    release();
  };
  io.listen(win.gBrowser.tabContainer, "dragend", stop, true);
  return { stop, partner: () => looking ?? before() };
}

// --- タブの列の束の上に落とす -------------------------------------------------

function stripDrop(io: Io, win: ChromeWindow): void {
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
    const found = onWrapper(win, ev);
    light(found?.wrapper ?? null);
    if (!found) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
  }, true);

  io.listen(strip, "drop", (ev: DragEvent) => {
    const found = onWrapper(win, ev);
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

/** 落とせる束と、落とされているタブ。どちらか欠けたら null */
function onWrapper(win: ChromeWindow, ev: DragEvent): { wrapper: SplitViewWrapper; tab: XULTab } | null {
  const tab = dragged(win, ev);
  if (!tab) return null;
  const over = ev.target as Element | null;
  const wrapper = over?.closest?.("tab-split-view-wrapper") as SplitViewWrapper | null;
  if (!wrapper || wrapper.tabs.length >= MAX_PANES) return null;
  if (tab.splitview === wrapper) return null;
  return { wrapper, tab };
}

// --- ページの上に落とす(Vivaldi 式) -----------------------------------------

function pageDrop(io: Io, win: ChromeWindow, before: () => XULTab | null): void {
  const tabpanels = win.gBrowser.tabpanels;
  if (!tabpanels) return;

  // どこに入るかの矩形。ページの上に浮くので、自分は当たり判定を持たない
  const hint = win.document.createXULElement("box") as unknown as HTMLElement;
  hint.className = "nora-split-hint";
  hint.hidden = true;
  io.place(hint, { parent: tabpanels });
  const hide = (): void => {
    hint.hidden = true;
  };

  io.listen(tabpanels, "dragover", (ev: DragEvent) => {
    const tab = dragged(win, ev);
    if (!tab) return;
    const partner = mate(win, before(), tab);
    // 相手が居なければ、並べようがない。それでも新しい窓にはできる
    ev.preventDefault();
    // ここから先へは渡さない。ページの上の drop は本体にも受け手が居て、
    // 渡すと「その URL を開く」が二重に走る(空のタブが増える)
    ev.stopPropagation();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
    const box = tabpanels.getBoundingClientRect();
    const zone = zoneOf(box, ev.clientX, ev.clientY, !!partner);
    show(hint, zone, partner ? panes(partner) + 1 : 1);
  }, true);

  io.listen(tabpanels, "drop", (ev: DragEvent) => {
    const tab = dragged(win, ev);
    hide();
    if (!tab) return;
    ev.preventDefault();
    // stopImmediatePropagation ではない ── 同じ tabpanels の capture には、この
    // 後ろに掴みの後始末が並んでいて、それまで止めてしまう
    ev.stopPropagation();
    // 「move として受け取った」と言い切る。本体の dragend はここを見て、
    // タブを新しい窓へ引きちぎる道に入るかどうかを決める
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
    const partner = mate(win, before(), tab);
    const box = tabpanels.getBoundingClientRect();
    const zone = zoneOf(box, ev.clientX, ev.clientY, !!partner);
    if (zone === "window" || !partner) {
      win.gBrowser.replaceTabWithWindow(tab);
      return;
    }
    holdLayout(zone === "top" || zone === "bottom" ? "rows" : "columns");
    join(win, partner, tab, zone === "start" || zone === "top");
  }, true);

  io.listen(tabpanels, "dragleave", (ev: DragEvent) => {
    // 中の要素へ移っただけの dragleave は無視する(出たり入ったりで点滅する)
    const to = ev.relatedTarget as Node | null;
    if (to && tabpanels.contains(to)) return;
    hide();
  }, true);
  io.listen(tabpanels, "dragend", hide, true);
}

/** 掴む前に見ていたもの。それが分割ビューなら束ごと、ふつうのタブならそのタブ */
function mate(win: ChromeWindow, before: XULTab | null, tab: XULTab): SplitViewWrapper | XULTab | null {
  const found = before ?? win.gBrowser.selectedTab;
  if (!found || found === tab || !found.parentNode) return null;
  const wrapper = found.splitview;
  if (wrapper) return wrapper.tabs.length < MAX_PANES && tab.splitview !== wrapper ? wrapper : null;
  return found.pinned ? null : found;
}

function panes(partner: SplitViewWrapper | XULTab): number {
  return "tabs" in partner ? partner.tabs.length : 1;
}

/** 相手と並べる。束があればそこへ足し、無ければ二枚で始める */
function join(win: ChromeWindow, partner: SplitViewWrapper | XULTab, tab: XULTab, first: boolean): void {
  if ("tabs" in partner) {
    // 束への差し込みは末尾。先頭に入れる道は本体に無い(addTabs は push)
    partner.addTabs([tab]);
  } else {
    win.gBrowser.addTabSplitView(first ? [tab, partner] : [partner, tab]);
  }
  win.gBrowser.selectedTab = tab;
}

/** 手がどこに居るか。真ん中は新しい窓、外側はいちばん近い端 */
function zoneOf(box: DOMRect, x: number, y: number, canSplit: boolean): Zone {
  const u = (x - box.left) / box.width;
  const v = (y - box.top) / box.height;
  const edge = Math.min(u, 1 - u, v, 1 - v);
  if (!canSplit || edge > MIDDLE / 2) return "window";
  if (edge === u) return "start";
  if (edge === 1 - u) return "end";
  return edge === v ? "top" : "bottom";
}

/** 矩形を、落としたらそこに座る場所へ。新しい窓のときは、浮いた小さな窓の絵 */
function show(hint: HTMLElement, zone: Zone, panes: number): void {
  const share = `${(100 / Math.max(panes, 2)).toFixed(2)}%`;
  const set = (inline: string, block: string, w: string, h: string): void => {
    hint.style.setProperty("inset-inline", inline);
    hint.style.setProperty("inset-block", block);
    hint.style.setProperty("width", w);
    hint.style.setProperty("height", h);
  };
  if (zone === "window") set("0", "0", "62%", "62%"); // 中央寄せは margin: auto(style.ts)
  else if (zone === "start") set("0 auto", "0", share, "auto");
  else if (zone === "end") set("auto 0", "0", share, "auto");
  else if (zone === "top") set("0", "0 auto", "auto", share);
  else set("0", "auto 0", "auto", share);
  hint.dataset.zone = zone;
  hint.hidden = false;
}

// --- 共通 ---------------------------------------------------------------------

/** 引きずられているのが、この窓の、足せるタブなら、そのタブ */
function dragged(win: ChromeWindow, ev: DragEvent): XULTab | null {
  const dt = ev.dataTransfer as TabTransfer | null;
  if (!dt || !Array.from(dt.types).includes(TAB_FLAVOR)) return null;
  const tab = dt.mozGetDataAt(TAB_FLAVOR, 0) as XULTab | null;
  // ほかの窓から来たタブは本体の作法(adoptTab)が要るので、ここでは受けない
  if (!tab || tab.ownerDocument !== win.document || tab.pinned) return null;
  return tab;
}
