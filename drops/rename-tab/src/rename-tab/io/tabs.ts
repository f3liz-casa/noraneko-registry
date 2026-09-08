// SPDX-License-Identifier: MPL-2.0
// What a name looks like on a tab: an attribute for the stylesheet to match, and
// the name itself as a custom property. The tab's own label is left alone -- it
// is still there underneath, and it comes back the moment the name goes.

import type { ChromeWindow, XULTab } from "../types/tab.ts";
import { shownName } from "../ops/names.ts";
import { nameOn } from "./store.ts";

export function apply(tab: XULTab): void {
  const name = shownName(nameOn(tab));
  if (name) {
    tab.setAttribute("data-customlabel", "");
    // JSON.stringify so the value arrives at `content:` quoted, with any quote
    // inside it escaped
    tab.style.setProperty("--customlabel", JSON.stringify(name));
  } else {
    tab.removeAttribute("data-customlabel");
    tab.style.removeProperty("--customlabel");
  }
}

export function applyAll(win: ChromeWindow): void {
  for (const tab of win.gBrowser.tabs) apply(tab);
}

/** Everything this drop put on the tabs, taken off again. */
export function clearAll(win: ChromeWindow): void {
  for (const tab of win.gBrowser.tabs) {
    tab.removeAttribute("data-customlabel");
    tab.style.removeProperty("--customlabel");
  }
}
