// SPDX-License-Identifier: MPL-2.0

// ブラウザ自身の命令の表。`DoCommand("back")` の "back" が、ここで一つの
// 関数になる。
//
// 出どころは Floorp の mouse-gesture/utils/actions.ts(94 個)。名前はそこから
// `gecko-` を落としただけで、中身も同じものを呼んでいる -- 一度ここに書いて
// 一度審査されれば、以後どの drop も **宣言に一行足すだけ**で使える。
// drop ごとに JS を書くのとの差が、いちばん大きく出るところ。
//
// 三つのきまり:
//
//   - **宣言に無い名前は実行しない**(殻が断る。tsubakiActor.ts の perform)
//   - **表に無い名前も実行しない**。drop が綴りを間違えても、ブラウザの
//     知らない口が開くことはない
//   - どれも **いま見ている窓**に効く。窓を選ぶ道は、ここには無い
//
// 入れなかったもの(Floorp の 74 のうち 16): ページを scroll する八つは content の
// actor が要る(段 7)、workspace の二つと toggle-sidebar と workspaces の設定は
// Floorp 自身の機能で gecko ではない、そして窓を開け閉めする四つは別の宣言にする。
//
// 呼び先が無い版の Firefox もありうるので、呼ぶのは try の中(tsubakiActor.ts)。
// 落ちたときは console に一行で、view も他の effect も止めない。

/** A chrome window, as far as this table is concerned. */
// deno-lint-ignore no-explicit-any
type Win = any;

/** ツールバーのボタンを、そこにあれば押す(戻る・進む・再読み込み) */
function doCommand(win: Win, id: string): void {
  const el = win.document.getElementById(id);
  if (el?.doCommand) el.doCommand();
  else console.warn("[command] この窓に無いボタン:", id);
}

/** いま見ているものの次に新しく見られていたタブ */
function lastSeen(win: Win): void {
  let latest = null;
  for (const tab of win.gBrowser.tabs) {
    if (tab._lastAccessed === Infinity || tab === win.gBrowser.selectedTab) continue;
    if (!latest || tab._lastAccessed > latest._lastAccessed) latest = tab;
  }
  if (latest) win.gBrowser.selectedTab = latest;
}

export const COMMANDS: Record<string, (win: Win) => void> = {
  "back": (win) => doCommand(win, "back-button"),
  "forward": (win) => doCommand(win, "forward-button"),
  "reload": (win) => doCommand(win, "reload-button"),
  "force-reload": (win) => win.BrowserCommands.reloadSkipCache(),
  "stop": (win) => win.gBrowser.selectedBrowser.stop(),
  "open-home-page": (win) => win.switchToTabHavingURI(Services.prefs.getStringPref("browser.startup.homepage"), true),
  "open-new-tab": (win) => win.BrowserCommands.openTab(),
  "duplicate-tab": (win) => win.gBrowser.duplicateTab(win.gBrowser.selectedTab),
  "close-tab": (win) => win.gBrowser.removeCurrentTab({ animate: true }),
  "close-other-tabs": (win) => win.gBrowser.removeTabs(win.gBrowser.visibleTabs.filter((t) => t !== win.gBrowser.selectedTab)),
  "close-tabs-to-start": (win) => win.gBrowser.removeTabsToTheStartFrom(win.gBrowser.selectedTab),
  "close-tabs-to-end": (win) => win.gBrowser.removeTabsToTheEndFrom(win.gBrowser.selectedTab),
  "reload-all-tabs": (win) => win.gBrowser.reloadTabs(win.gBrowser.tabs),
  "restore-last-tab": (win) => win.SessionStore.undoCloseTab(win, 0),
  "show-next-tab": (win) => win.gBrowser.tabContainer.advanceSelectedTab(1, true),
  "show-previous-tab": (win) => win.gBrowser.tabContainer.advanceSelectedTab(-1, true),
  "show-previously-selected-tab": (win) => lastSeen(win),
  "show-all-tabs-panel": (win) => win.gTabsPanel.showAllTabsPanel(),
  "mute-current-tab": (win) => win.gBrowser.toggleMuteAudioOnMultiSelectedTabs(win.gBrowser.selectedTab),
  "restore-last-window": (win) => win.SessionWindowUI.undoCloseWindow(0),
  "restore-last-session": (win) => win.SessionStore.restoreLastSession(),
  "zoom-in": (win) => win.FullZoom.enlarge(),
  "zoom-out": (win) => win.FullZoom.reduce(),
  "reset-zoom": (win) => win.FullZoom.reset(),
  "enter-into-customize-mode": (win) => win.gCustomizeMode.enter(),
  "enter-into-offline-mode": (win) => win.BrowserOffline.toggleOfflineStatus(),
  "bookmark-this-page": (win) => win.PlacesCommandHook.bookmarkPage(),
  "open-bookmark-add-tool": (win) => win.PlacesUIUtils.showBookmarkPagesDialog(win.PlacesCommandHook.uniqueCurrentPages),
  "open-bookmarks-manager": (win) => win.SidebarController.toggle("viewBookmarksSidebar"),
  "toggle-bookmark-toolbar": (win) => win.BookmarkingUI.toggleBookmarksToolbar("bookmark-tools"),
  "show-bookmark-sidebar": (win) => win.SidebarController.show("viewBookmarksSidebar"),
  "search-history": (win) => win.PlacesCommandHook.searchHistory(),
  "manage-history": (win) => win.PlacesCommandHook.showPlacesOrganizer("History"),
  "show-history-sidebar": (win) => win.SidebarController.show("viewHistorySidebar"),
  "forget-history": (win) => win.Sanitizer.showUI(win),
  "quick-forget-history": (win) => win.PlacesUtils.history.clear(true),
  "save-page": (win) => win.saveBrowser(win.gBrowser.selectedBrowser),
  "print-page": (win) => win.PrintUtils.startPrintWindow(win.gBrowser.selectedBrowser.browsingContext),
  "show-source-of-page": (win) => win.BrowserViewSource(win.gBrowser.selectedBrowser),
  "show-page-info": (win) => win.BrowserCommands.pageInfo(),
  "send-with-mail": (win) => win.MailIntegration.sendLinkForBrowser(win.gBrowser.selectedBrowser),
  "open-screen-capture": (win) => win.ScreenshotsUtils.start(win.gBrowser.selectedBrowser),
  "search-in-this-page": (win) => win.gLazyFindCommand("onFindCommand"),
  "show-next-search-result": (win) => win.gLazyFindCommand("onFindAgainCommand", false),
  "show-previous-search-result": (win) => win.gLazyFindCommand("onFindAgainCommand", true),
  "search-the-web": (win) => win.BrowserSearch.webSearch(),
  "show-synced-tabs-sidebar": (win) => win.SidebarController.show("viewTabsSidebar"),
  "reverse-sidebar": (win) => win.SidebarController.reversePosition(),
  "hide-sidebar": (win) => win.SidebarController.hide(),
  "open-general-preferences": (win) => win.openPreferences(),
  "open-privacy-preferences": (win) => win.openPreferences("panePrivacy"),
  "open-containers-preferences": (win) => win.openPreferences("paneContainers"),
  "open-search-preferences": (win) => win.openPreferences("paneSearch"),
  "open-sync-preferences": (win) => win.openPreferences("paneSync"),
  "open-addons-manager": (win) => win.BrowserAddonUI.openAddonsMgr(),
  "open-downloads": (win) => win.DownloadsPanel.showDownloadsHistory(),
  "open-task-manager": (win) => win.switchToTabHavingURI("about:processes", true),
  "open-migration-wizard": (win) => win.MigrationUtils.showMigrationWizard(win, { entrypoint: win.MigrationUtils.MIGRATION_ENTRYPOINTS.FILE_MENU }),
};
