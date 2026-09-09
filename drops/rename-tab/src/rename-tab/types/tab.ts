// SPDX-License-Identifier: MPL-2.0

/** One renamed tab, as the pref holds it (the same shape noraneko's own tab-rename used). */
export interface TabName {
  /** The tab's linkedPanel: what identifies a tab for as long as it lives. */
  tabId: string;
  /** What the person typed. */
  customName: string;
  /** The title the tab had when it was first renamed -- offered as the placeholder later. */
  originalTitle: string;
}

export type XULTab = HTMLElement & { linkedPanel?: string };

export type ChromeWindow = Window & {
  gBrowser: { tabs: XULTab[]; tabContainer: HTMLElement };
  /** Firefox sets this while the tab context menu is open. */
  TabContextMenu?: { contextTab: XULTab | null };
};
