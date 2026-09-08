// SPDX-License-Identifier: MPL-2.0
// What the view reads. Signals: change one and the parts that read it redraw.

import { computed, signal } from "std";
import type { Panel, XULPopup } from "../types/panel.ts";
import { webPanels } from "../ops/panels.ts";

/** The whole list as it is in prefs (kept in step by a pref observer). */
export const panels = signal<Panel[]>([]);
/** The ones shown in the strip. */
export const shown = computed(() => webPanels(panels.value));
/** The open panel's id, or null when the box is closed. */
export const selected = signal<string | null>(null);
/** Title of the open panel's page. */
export const title = signal("");

/** The context menu on a strip button: the popup element and which panel it was opened on. */
export const menu = { popup: null as XULPopup | null, target: null as string | null };
