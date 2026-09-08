// SPDX-License-Identifier: MPL-2.0
// The panel list lives in prefs. Read here, write here, nowhere else.

import type { FloorpConfig, Panel } from "../types/panel.ts";
import { PREF_DATA, PREF_FLOORP_CONFIG, PREF_FLOORP_DATA } from "../data/prefs.ts";
import { parsePanels } from "../ops/panels.ts";

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

export function readFloorpConfig(): FloorpConfig {
  try {
    return JSON.parse(Services.prefs.getStringPref(PREF_FLOORP_CONFIG, "{}"));
  } catch {
    return {};
  }
}
