// SPDX-License-Identifier: MPL-2.0

// rename-tab: give a tab a name of your own. Right-click a tab → "Rename tab…",
// or press F2 on the tab you are on; type, Enter. Escape leaves it as it was, and
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
import { addMenuItems } from "./io/menu.ts";
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

  // F2 renames the tab you are on -- the way a file manager does it. Not while
  // you are typing somewhere else in the window.
  ctx.io.listen(doc, "keydown", (event: Event) => {
    const key = event as KeyboardEvent;
    if (key.key !== "F2" || key.defaultPrevented) return;
    const where = doc.activeElement?.localName ?? "";
    if (where === "input" || where === "textarea" || where === "browser") return;
    key.preventDefault();
    rename(win.gBrowser.selectedTab);
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
