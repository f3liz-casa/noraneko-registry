// SPDX-License-Identifier: MPL-2.0
// Pure: lists in, lists out. Nothing here touches prefs or the window.

import type { FloorpConfig, Panel } from "../types/panel.ts";
import { DEFAULT_WIDTH } from "../data/prefs.ts";

export function parsePanels(text: string): Panel[] | null {
  try {
    const parsed = JSON.parse(text) as { data?: unknown };
    return Array.isArray(parsed.data) ? (parsed.data as Panel[]) : null;
  } catch {
    return null;
  }
}

/** The ones we can show: web panels with a URL. */
export function webPanels(panels: Panel[]): Panel[] {
  return panels.filter((p) => p.type === "web" && typeof p.url === "string");
}

export function patchPanel(panels: Panel[], id: string, patch: Partial<Panel>): Panel[] {
  return panels.map((p) => (p.id === id ? { ...p, ...patch } : p));
}

export function withoutPanel(panels: Panel[], id: string): Panel[] {
  return panels.filter((p) => p.id !== id);
}

export function panelWidth(panel: Panel, config: FloorpConfig): number {
  return panel.width || config.globalWidth || DEFAULT_WIDTH;
}
