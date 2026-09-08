// SPDX-License-Identifier: MPL-2.0
// Two rows in the tab's own context menu. A menuitem is one element with one
// listener, so they are placed by hand (through ctx.io, which remembers to take
// them out) rather than drawn by a view.
//
// "Clear name" only appears on a tab that has one: a row that would do nothing
// is worse than no row.

import type { ChromeWindow, XULTab } from "../types/tab.ts";
import { MENU_CLEAR, MENU_RENAME } from "../data/prefs.ts";
import { nameOn } from "./store.ts";

interface Io {
  place(node: Node, at: { before: Node } | { parent: Node }): void;
  listen(target: EventTarget, type: string, fn: (e: Event) => void): void;
}

export function addMenuItems(io: Io, win: ChromeWindow, onRename: (tab: XULTab) => void, onClear: (tab: XULTab) => void): void {
  const doc = win.document;
  const popup = doc.getElementById("tabContextMenu");
  if (!popup) return;
  // Firefox's own "Move Tab" submenu, so the rows land with their neighbours
  const moveTab = doc.getElementById("context_moveTabOptions");
  const at = moveTab && moveTab.parentNode === popup ? { before: moveTab } : { parent: popup };

  const row = (id: string, label: string, run: (tab: XULTab) => void) => {
    const item = doc.createXULElement("menuitem");
    item.id = id;
    item.setAttribute("label", label);
    io.place(item, at);
    io.listen(item, "command", () => {
      const tab = win.TabContextMenu?.contextTab;
      if (tab) run(tab);
    });
    return item;
  };

  const rename = row("nora-rename-tab", MENU_RENAME, onRename);
  const clear = row("nora-rename-tab-clear", MENU_CLEAR, onClear);
  io.listen(popup, "popupshowing", () => {
    const tab = win.TabContextMenu?.contextTab;
    // the attribute, not the property: in XUL that is what hides a row
    if (tab && nameOn(tab)) clear.removeAttribute("hidden");
    else clear.setAttribute("hidden", "true");
  });
}
