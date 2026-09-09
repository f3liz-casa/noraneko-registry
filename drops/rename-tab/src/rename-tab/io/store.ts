// SPDX-License-Identifier: MPL-2.0
// Where a name lives: on the tab itself, through SessionStore.
//
// The first shape of this (and noraneko's own tab-rename before it) kept one
// pref for the whole browser, keyed by `linkedPanel`. That key is made fresh
// every time the browser starts, so the names either vanished or -- worse --
// landed on whichever tab happened to get that panel id next. SessionStore's
// per-tab values are the thing that actually follows a tab: across a restart,
// through session restore, and from one window to another.
//
// The old pref is still read once, so a name given before this carries over.

import type { ChromeWindow, TabName, XULTab } from "../types/tab.ts";
import { PREF_DATA } from "../data/prefs.ts";
import { parseNames } from "../ops/names.ts";

const KEY = "nora-rename-tab";

interface SessionStoreApi {
  getCustomTabValue(tab: XULTab, key: string): string;
  setCustomTabValue(tab: XULTab, key: string, value: string): void;
  deleteCustomTabValue(tab: XULTab, key: string): void;
}

// inside a function, not at the top level: the build reads this module under
// Deno to find `meta`, and there is no ChromeUtils there
let api: SessionStoreApi | null = null;
function sessionStore(): SessionStoreApi {
  return (api ??= ChromeUtils.importESModule(
    "resource:///modules/sessionstore/SessionStore.sys.mjs",
  ).SessionStore as SessionStoreApi);
}

export function nameOn(tab: XULTab): TabName | null {
  try {
    const raw = sessionStore().getCustomTabValue(tab, KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as TabName;
    return typeof value?.customName === "string" ? value : null;
  } catch {
    return null;
  }
}

export function setNameOn(tab: XULTab, customName: string, originalTitle: string): void {
  sessionStore().setCustomTabValue(tab, KEY, JSON.stringify({ customName, originalTitle }));
}

export function clearNameOn(tab: XULTab): void {
  sessionStore().deleteCustomTabValue(tab, KEY);
}

/** Names given before this drop kept them on the tab: read the old pref once. */
export function adoptOldPref(win: ChromeWindow): void {
  const old = parseNames(Services.prefs.getStringPref(PREF_DATA, "{}"));
  if (old.length === 0) return;
  let taken = 0;
  for (const tab of win.gBrowser.tabs) {
    if (nameOn(tab)) continue;
    const found = old.find((n) => n.tabId === tab.linkedPanel);
    if (!found) continue;
    setNameOn(tab, found.customName, found.originalTitle);
    taken += 1;
  }
  if (taken) console.log(`[rename-tab] took ${taken} name(s) over from ${PREF_DATA}`);
}
