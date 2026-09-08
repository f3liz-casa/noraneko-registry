// SPDX-License-Identifier: MPL-2.0
// Pure: text in, values out. Nothing here touches prefs, tabs or the window.

import type { TabName } from "../types/tab.ts";

/** The old pref held `{ [linkedPanel]: TabName }` -- read for carrying names over. */
export function parseNames(text: string): TabName[] {
  try {
    const parsed = JSON.parse(text) as Record<string, TabName>;
    return Object.values(parsed).filter((n) => n && typeof n.tabId === "string" && typeof n.customName === "string");
  } catch {
    return [];
  }
}

/** What the tab shows: the name if there is one, its own title otherwise. */
export function shownName(name: TabName | null): string | null {
  const trimmed = name?.customName?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}
