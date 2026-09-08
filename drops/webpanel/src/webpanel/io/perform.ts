// SPDX-License-Identifier: MPL-2.0
// The one place with side effects. An effect is data the logic made; here it
// finally touches the window: a <browser>, the prefs, the context menu.

import type { Panel, XULPopupHost } from "../types/panel.ts";
import type { Effect } from "../types/view.ts";
import { drop, hideAll, reload, show } from "./browsers.ts";
import { writePanels } from "./prefs.ts";

/** The <menupopup> the view draws into; set once, when it is mounted. */
export const menu: XULPopupHost = { popup: null };

export function perform(e: Effect): void {
  switch (e.__type) {
    case "ShowPanel":
      show(e.id as string, e.url as string);
      break;
    case "HidePanels":
      hideAll();
      break;
    case "ReloadPanel":
      reload(e.id as string);
      break;
    case "DropPanel":
      drop(e.id as string);
      break;
    case "PersistPanels":
      writePanels(e.panels as Panel[]);
      break;
    case "ShowMenu":
      menu.popup?.openPopupAtScreen(e.x as number, e.y as number, true);
      break;
    default:
      console.warn("[webpanel] no one carries out", e.__type);
  }
}
