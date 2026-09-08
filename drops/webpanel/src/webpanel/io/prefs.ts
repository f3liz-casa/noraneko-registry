// SPDX-License-Identifier: MPL-2.0
// The panel list lives in prefs. Read here, written here, nowhere else. The
// entries are handed on and taken back exactly as they are: the logic keeps each
// one whole (ops/webpanel.tsubaki's `raw`), so fields this drop never reads --
// icon, userContextId, zoomLevel, userAgent, extensionId -- survive the trip.

import { adoptPref } from "std";
import type { Panel } from "../types/panel.ts";
import { PREF_DATA, PREF_FLOORP_CONFIG, PREF_FLOORP_DATA, type WebpanelPrefs } from "../data/prefs.ts";

/** Our list; if we have none yet, Floorp's (copied once, so from then on only ours is read and written). */
export function readPanels(): Panel[] {
  if (Services.prefs.prefHasUserValue(PREF_DATA)) {
    return parsePanels(Services.prefs.getStringPref(PREF_DATA, "")) ?? [];
  }
  const floorp = parsePanels(Services.prefs.getStringPref(PREF_FLOORP_DATA, ""));
  if (floorp) {
    writePanels(floorp);
    console.log(`[webpanel] copied ${floorp.length} panel(s) from ${PREF_FLOORP_DATA}`);
    return floorp;
  }
  return [];
}

export function writePanels(panels: Panel[]): void {
  Services.prefs.setStringPref(PREF_DATA, JSON.stringify({ data: panels }));
}

/**
 * Floorp's two settings, out of its one JSON pref and into one pref each -- once,
 * and only while nobody has answered them here. Floorp's pref is left as it is.
 */
export function adoptFloorpConfig(prefs: WebpanelPrefs): void {
  adoptPref(prefs.globalWidth, PREF_FLOORP_CONFIG, "globalWidth");
  adoptPref(prefs.positionStart, PREF_FLOORP_CONFIG, "position_start");
}

function parsePanels(text: string): Panel[] | null {
  try {
    const parsed = JSON.parse(text) as { data?: unknown };
    return Array.isArray(parsed.data) ? (parsed.data as Panel[]) : null;
  } catch {
    return null;
  }
}
