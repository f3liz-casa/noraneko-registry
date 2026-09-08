// SPDX-License-Identifier: MPL-2.0

// rename-tab: give a tab a name of your own. Double-click it, press F2, or
// right-click → "Rename tab…". With the tab strip itself focused (Tab into it),
// Return does it too -- Finder's key, and Finder's rule that the item has to be
// selected there. Type, Enter. Escape leaves it as it was, and
// an empty name gives the tab its own title back ("Clear name" does the same, and
// only shows on a tab that has one).
//
// Brought over from noraneko's own `browser-features/chrome/common/tab-rename`
// (f3liz-casa/noraneko#150), as a drop, with two things changed after using it:
//
//   - the name lives ON the tab (SessionStore), not in one pref keyed by
//     `linkedPanel`. That key is made fresh every restart, so names used to
//     vanish -- or land on whichever tab got the id next. A name given before
//     this is read once and carried over (io/store.ts).
//   - F2, and a "Clear name" row, because right-click → menu was the only way in
//     and there was no way out except opening the box and clearing it by hand.
//
// This actor matches the browser window itself (browser.xhtml), so the content
// hook runs inside that window: `window` is the ChromeWindow (gBrowser and
// TabContextMenu in reach), `document` is browser.xhtml. Nothing is asked of the
// main process; `parent` is empty. No deps: there is no view to draw here, only
// two menu rows, one input while you type, and an attribute on the tab.
//
// Layers: types/ data/ ops/ (pure) io/ (the tabs, the store, the menu, the
// input) ui/ (the stylesheet). Everything placed in the window goes through
// ctx.io, so when the drop is removed it all comes out again by itself.

import {
  defineContent,
  defineParent,
  type ActorMeta,
  type ContentCtx,
} from "../_shared/defineActor.ts";
import type { ChromeWindow, XULTab } from "./types/tab.ts";
import { apply, applyAll, clearAll } from "./io/tabs.ts";
import { adoptOldPref, clearNameOn, nameOn, setNameOn } from "./io/store.ts";
import { askOn } from "./io/input.ts";
import { addMenuItems, addShortcut } from "./io/menu.ts";
import { STYLE } from "./ui/style.ts";

export const meta: ActorMeta = {
  id: "rename-tab@noraneko.app",
  version: "1.0.0",
  namespace: "noraRenameTab",
  matches: ["chrome://browser/content/browser.xhtml"],
  runAt: "document_end",
};

export const parent = defineParent({});

export const content = defineContent<typeof parent>((_parent, ctx) => {
  main(ctx).catch((e) => console.error("[rename-tab] failed:", e));
});

async function main(ctx: ContentCtx): Promise<void> {
  const win = window as unknown as ChromeWindow;
  const doc = document;
  // popup windows (window.open with features) have no tab strip to rename
  if ((doc.documentElement.getAttribute("chromehidden") ?? "").includes("toolbar")) return;
  if (doc.getElementById("nora-rename-tab")) return;
  await (win as unknown as { delayedStartupPromise: Promise<void> }).delayedStartupPromise;

  ctx.io.style(doc, STYLE);
  adoptOldPref(win);
  applyAll(win);
  // the tabs are the drop's to put back
  ctx.onDestroy(() => clearAll(win));

  // a tab opened, or came back from a restore: it may carry a name already
  ctx.io.listen(win.gBrowser.tabContainer, "TabOpen", (event: Event) => apply(event.target as XULTab));
  ctx.io.listen(win.gBrowser.tabContainer, "SSTabRestored", (event: Event) => apply(event.target as XULTab));

  // F2 from anywhere in the window (a real shortcut; see addShortcut).
  addShortcut(ctx.io, win, () => rename(win.gBrowser.selectedTab));

  // Return, while the tab strip itself has the focus -- Finder's key, and the
  // same thing Finder asks for: the item has to be selected THERE. Tab into the
  // strip (or arrow along it) and press Return.
  //
  // It cannot be made to work after a mouse click on a tab: the click leaves the
  // focus in the page, so Return goes to the page and chrome never sees it. The
  // only way to catch it anyway would be to take Return from every page in the
  // browser, which is not a trade worth making for a rename. Double-click is the
  // gesture for the mouse.
  ctx.io.listen(doc, "keydown", (event: Event) => {
    const key = event as KeyboardEvent;
    if (key.key !== "Enter" || key.defaultPrevented) return;
    if (key.altKey || key.ctrlKey || key.metaKey || key.shiftKey) return;
    const focused = doc.activeElement;
    const inTabStrip = focused?.localName === "tab" || focused === (win.gBrowser.tabContainer as unknown as Element);
    if (!inTabStrip) return;
    key.preventDefault();
    rename(win.gBrowser.selectedTab);
  });

  // Double-click on the tab, the other thing hands reach for. Not when Firefox
  // has been told double-click closes a tab -- that pref is someone saying what
  // this gesture means to them, and it was theirs first.
  ctx.io.listen(win.gBrowser.tabContainer, "dblclick", (event: Event) => {
    const click = event as MouseEvent;
    if (click.button !== 0 || click.defaultPrevented) return;
    if (Services.prefs.getBoolPref("browser.tabs.closeTabByDblclick", false)) return;
    const target = click.target as Element | null;
    if (target?.closest(".tab-close-button")) return;
    const tab = target?.closest(".tabbrowser-tab") as XULTab | null;
    if (!tab) return;
    click.preventDefault();
    rename(tab);
  });

  addMenuItems(ctx.io, win, rename, (tab) => {
    clearNameOn(tab);
    apply(tab);
  });
}

function rename(tab: XULTab): void {
  const found = nameOn(tab);
  const title = tab.getAttribute("label") ?? "";
  askOn(tab, found?.customName ?? "", found?.originalTitle || title, (typed) => {
    if (typed === "") clearNameOn(tab);
    else setNameOn(tab, typed, found?.originalTitle || title);
    apply(tab);
  });
}
