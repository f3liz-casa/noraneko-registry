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
// What decides anything is `ops/webpanel.tsubaki`: one state, `update(state,
// action)` returning the next state and effects as data, and `view(state)`
// returning a tree of data. This side only carries things out --
// ui/View.tsx turns the tree into elements, io/perform.ts is the one place with
// side effects, io/prefs.ts and io/browsers.ts are the hands. Everything placed
// in the window goes through ctx.io / mount, so when the drop is removed it all
// comes out again by itself.
//
// The panel list is kept in the same shape as Floorp's floorp.panelSidebar.data
// ({ data: Panel[] }), so a list from Floorp carries over: read once when we
// have nothing of our own, then written only to noraneko.webpanel.data.
//
// A browser-window actor runs in the parent process, where wasm can't be
// compiled on the main thread at all (Firefox treats it as eval). So the drop
// tooling runs this actor's Tsubaki in a ChromeWorker instead -- where wasm is
// governed by the worker's own CSP and nothing else -- and `ctx.ops` is three
// verbs over postMessage. The view's thread stays free.

import {
  defineContent,
  defineParent,
  type ActorMeta,
  type ContentCtx,
} from "../_shared/defineActor.ts";
import { h, mount } from "std";
import type { ChromeWindow, XULPopup } from "./types/panel.ts";
import type { Frame } from "./types/view.ts";
import { PREF_DATA } from "./data/prefs.ts";
import { readFloorpConfig, readPanels } from "./io/prefs.ts";
import { menu, perform } from "./io/perform.ts";
import { attach, dispatch } from "./state/store.ts";
import { STYLE } from "./ui/style.ts";
import { Menu, Sidebar } from "./ui/View.tsx";

export const meta: ActorMeta = {
  id: "webpanel@noraneko.app",
  version: "1.2.1",
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

  const ops = ctx.ops;
  if (!ops) throw new Error("webpanel needs std's Tsubaki runtime (ctx.ops)");
  await ops.load("ops/webpanel.tsubaki");

  const config = readFloorpConfig();
  const positionStart = config.position_start === true;
  const first = (await ops.call("start", readPanels(), positionStart, config.globalWidth ?? 400)) as Frame;

  ctx.io.style(doc, STYLE);
  attach(ops, perform, first);
  ctx.io.pref(PREF_DATA, () => dispatch({ __type: "SyncPanels", panels: readPanels() }));

  // right of the tabs, or left when Floorp's config says so
  const tabbox = doc.getElementById("tabbrowser-tabbox")!;
  const host = mount(ctx.io, h(Sidebar, { win }), {
    ...(positionStart ? { before: tabbox } : { after: tabbox }),
    tag: "hbox",
    id: "nora-webpanel",
  });
  if (!positionStart) host.setAttribute("positionend", "true");

  menu.popup = mount(ctx.io, h(Menu, { win }), {
    parent: doc.getElementById("mainPopupSet")!,
    tag: "menupopup",
    id: "nora-webpanel-menu",
  }) as XULPopup;
}
