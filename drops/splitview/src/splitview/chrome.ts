// SPDX-License-Identifier: MPL-2.0

// 本体の分割ビューのうち、この drop が名前で呼ぶものだけ。窓のものは何でも
// 触れてしまうので、「触れる」ことと「触ると言った」ことを分けておきたい ──
// ここに書いていないものは、この drop は知らない。
//
// 出どころは chrome://browser/content/browser/tabbrowser/{tabbrowser,tabsplitview}.js と
// chrome://global/content/elements/tabbox.js(MozTabpanels)。

export interface XULTab extends Element {
  linkedPanel: string;
  linkedBrowser: { currentURI?: { spec?: string } } | null;
  /** そのタブが入っている分割ビュー。入っていなければ null */
  splitview: SplitViewWrapper | null;
  selected: boolean;
  pinned: boolean;
  label: string;
}

/** <tab-split-view-wrapper>。タブの列の中で、分割ビューのタブたちを束ねている */
export interface SplitViewWrapper extends Element {
  tabs: XULTab[];
  addTabs(tabs: XULTab[], options?: { isSessionRestore?: boolean }): void;
  unsplitTabs(trigger?: string | null): void;
  /** その束が入っているタブグループ。入っていなければ null */
  group: TabGroup | null;
}

/** <tab-group>。色は --tab-group-color として、その要素に載っている */
export interface TabGroup extends Element {
  id: string;
  color: string;
  label: string;
  tabs: XULTab[];
}

/** <tabgroup-menu id="tab-group-editor">。グループの名前と色を編める、あのパネル */
export interface TabGroupEditor extends Element {
  activeGroup: TabGroup | null;
}

/** <tabpanels id="tabbrowser-tabpanels">。ページの入っている箱たちの親 */
export interface Tabpanels extends Element {
  /** いま分割ビューに出ている panel の id。順番は左上から */
  splitViewPanels: string[];
  setSplitViewActive(active: boolean): void;
  style: CSSStyleDeclaration;
}

export interface GBrowser {
  tabpanels: Tabpanels | null;
  tabContainer: Element;
  tabs: XULTab[];
  selectedTab: XULTab;
  selectedTabs: XULTab[];
  activeSplitView: SplitViewWrapper | null;
  showSplitViewPanels(tabs: XULTab[]): void;
  addTabSplitView(tabs: XULTab[], options?: { insertBefore?: XULTab | null }): SplitViewWrapper | null;
  addTrustedTab(url: string): XULTab;
  removeTab(tab: XULTab): void;
  /** タブを分割ビューの束へ。束の数えている中身も一緒に動く */
  moveTabToSplitView(tab: XULTab, wrapper: SplitViewWrapper, at?: number): void;
  /** タブの引っ越しを、本体の作法(選択やイベントの後始末)ごと包む */
  handleTabMove(element: Element, move: () => void): void;
  /** 分割ビューの束を、まるごとタブグループへ */
  moveSplitViewToExistingGroup(wrapper: SplitViewWrapper, group: TabGroup): void;
  /** そのタブを、新しい窓へ引っ越す */
  replaceTabWithWindow(tab: XULTab): void;
  getTabForBrowser(browser: unknown): XULTab | null;
}

export interface ChromeWindow extends Window {
  gBrowser: GBrowser;
  TabContextMenu?: { contextTab: XULTab | null };
  delayedStartupPromise: Promise<void>;
}

/** その窓の分割ビューにいま出ているペインたち(panel の要素。無ければ空) */
export function panesOf(win: ChromeWindow): HTMLElement[] {
  const tabpanels = win.gBrowser?.tabpanels;
  if (!tabpanels) return [];
  const out: HTMLElement[] = [];
  for (const id of tabpanels.splitViewPanels) {
    const el = win.document.getElementById(id);
    if (el) out.push(el);
  }
  return out;
}
