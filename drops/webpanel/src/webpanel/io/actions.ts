// SPDX-License-Identifier: MPL-2.0
// What a click does: change the store, and the prefs when the list changes.

import type { ChromeWindow, Panel } from "../types/panel.ts";
import { panels, selected, shown } from "../state/store.ts";
import { patchPanel, withoutPanel } from "../ops/panels.ts";
import { readPanels, writePanels } from "./prefs.ts";
import type { Browsers } from "./browsers.ts";

export function select(browsers: Browsers, id: string | null): void {
  if (id === null) {
    selected.value = null;
    browsers.hideAll();
    return;
  }
  const panel = shown.value.find((p) => p.id === id);
  if (!panel) return;
  selected.value = id;
  browsers.show(panel);
}

export function addCurrentTab(win: ChromeWindow, browsers: Browsers): void {
  const uri = win.gBrowser.currentURI;
  if (uri.scheme !== "http" && uri.scheme !== "https") return;
  const panel: Panel = { id: win.crypto.randomUUID(), type: "web", width: 0, url: uri.spec };
  writePanels([...readPanels(), panel]);
  syncPanels(browsers);
  select(browsers, panel.id);
}

export function unloadPanel(browsers: Browsers, id: string): void {
  browsers.unload(id);
  if (selected.value === id) select(browsers, null);
}

export function removePanel(browsers: Browsers, id: string): void {
  unloadPanel(browsers, id);
  writePanels(withoutPanel(readPanels(), id));
}

export function rememberWidth(box: HTMLElement | null): void {
  if (!selected.value || !box) return;
  writePanels(patchPanel(readPanels(), selected.value, { width: Math.round(box.getBoundingClientRect().width) }));
}

/** The prefs changed (here or in another window): read again, and drop browsers of panels that are gone. */
export function syncPanels(browsers: Browsers): void {
  panels.value = readPanels();
  for (const id of browsers.ids()) {
    if (!shown.value.some((p) => p.id === id)) unloadPanel(browsers, id);
  }
}
