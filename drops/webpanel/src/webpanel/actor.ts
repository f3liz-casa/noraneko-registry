// SPDX-License-Identifier: MPL-2.0

// webpanel: web pages in a sidebar next to the tabs. Floorp's panel sidebar,
// reduced to its core: a strip of icons, one <browser> per panel, "add the
// current tab", and the width remembered. No floating mode, no mobile UA, no
// containers, no settings page. Those can come as separate drops later.
//
// This actor matches the browser window itself (browser.xhtml), so the content
// hook runs inside that window with its privileges: `window` is the
// ChromeWindow (gBrowser and friends), `document` is browser.xhtml. Nothing is
// asked of the main process; `parent` is empty.
//
// Layers: types/ data/ ops/ (pure) io/ (prefs, the <browser>s, what a click does)
// state/ (signals) ui/ (preact). Everything placed in the window goes through
// ctx.io / mount, so when the drop is removed it all comes out again by itself.
//
// The panel list is kept in the same shape as Floorp's floorp.panelSidebar.data
// ({ data: Panel[] }), so a list from Floorp carries over: read once when we
// have nothing of our own, then written only to noraneko.webpanel.data.

import {
  defineContent,
  defineParent,
  type ActorMeta,
  type ContentCtx,
} from "../_shared/defineActor.ts";
import { h, mount } from "../_shared/ui.ts";
import type { ChromeWindow, XULPopup } from "./types/panel.ts";
import { PREF_DATA } from "./data/prefs.ts";
import { readFloorpConfig } from "./io/prefs.ts";
import { Browsers } from "./io/browsers.ts";
import { syncPanels } from "./io/actions.ts";
import { menu } from "./state/store.ts";
import { STYLE } from "./ui/style.ts";
import { Sidebar } from "./ui/Sidebar.tsx";
import { Menu } from "./ui/Menu.tsx";

export const meta: ActorMeta = {
  id: "webpanel@noraneko.app",
  version: "1.1.0",
  namespace: "noraWebpanel",
  matches: ["chrome://browser/content/browser.xhtml"],
  runAt: "document_end",
};

export const parent = defineParent({});

export const content = defineContent<typeof parent>((_parent, ctx) => {
  main(ctx).catch((e) => console.error("[webpanel] failed:", e));
});

async function main(ctx: ContentCtx): Promise<void> {
  const win = window as unknown as ChromeWindow;
  const doc = document;
  // popup windows (window.open with features) have no room for a sidebar
  if ((doc.documentElement.getAttribute("chromehidden") ?? "").includes("toolbar")) return;
  if (doc.getElementById("nora-webpanel")) return;
  await win.delayedStartupPromise;

  ctx.io.style(doc, STYLE);
  const browsers = new Browsers();
  syncPanels(browsers);
  ctx.io.pref(PREF_DATA, () => syncPanels(browsers));

  // right of the tabs, or left when Floorp's config says so
  const positionStart = readFloorpConfig().position_start === true;
  const tabbox = doc.getElementById("tabbrowser-tabbox")!;
  const host = mount(ctx.io, h(Sidebar, { win, browsers, positionStart }), {
    ...(positionStart ? { before: tabbox } : { after: tabbox }),
    tag: "hbox",
    id: "nora-webpanel",
  });
  if (!positionStart) host.setAttribute("positionend", "true");

  menu.popup = mount(ctx.io, h(Menu, { browsers }), {
    parent: doc.getElementById("mainPopupSet")!,
    tag: "menupopup",
    id: "nora-webpanel-menu",
  }) as XULPopup;
}
