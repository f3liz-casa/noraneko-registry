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
// The panel list is kept in the same shape as Floorp's floorp.panelSidebar.data
// ({ data: Panel[] }), so a list from Floorp carries over: read once when we
// have nothing of our own, then written only to noraneko.webpanel.data.

import {
  defineContent,
  defineParent,
  type ActorMeta,
  type ContentCtx,
} from "../_shared/defineActor.ts";

export const meta: ActorMeta = {
  id: "webpanel@noraneko.app",
  version: "1.0.0",
  namespace: "noraWebpanel",
  matches: ["chrome://browser/content/browser.xhtml"],
  runAt: "document_end",
};

export const parent = defineParent({});

export const content = defineContent<typeof parent>((_parent, ctx) => {
  main(ctx).catch((e) => console.error("[webpanel] failed:", e));
});

// --- data -------------------------------------------------------------------

const PREF_DATA = "noraneko.webpanel.data";
const PREF_FLOORP_DATA = "floorp.panelSidebar.data";
const PREF_FLOORP_CONFIG = "floorp.panelSidebar.config";
const DEFAULT_WIDTH = 400;

/** One entry of the list. Same fields as Floorp; only type "web" is shown here, the rest is kept as-is. */
interface Panel {
  id: string;
  type: "web" | "static" | "extension";
  width: number;
  url?: string | null;
  icon?: string | null;
  userContextId?: number | null;
  zoomLevel?: number | null;
  userAgent?: boolean | null;
  extensionId?: string | null;
}

function parsePanels(text: string): Panel[] | null {
  try {
    const parsed = JSON.parse(text) as { data?: unknown };
    return Array.isArray(parsed.data) ? (parsed.data as Panel[]) : null;
  } catch {
    return null;
  }
}

/** Our list; if we have none yet, Floorp's (copied once, so from then on only ours is read and written). */
function readPanels(): Panel[] {
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

function writePanels(panels: Panel[]): void {
  Services.prefs.setStringPref(PREF_DATA, JSON.stringify({ data: panels }));
}

function updatePanel(id: string, patch: Partial<Panel>): void {
  writePanels(readPanels().map((p) => (p.id === id ? { ...p, ...patch } : p)));
}

/** Floorp's config, for the two things we honour: default width and which side. */
function readFloorpConfig(): { globalWidth?: number; position_start?: boolean } {
  try {
    return JSON.parse(Services.prefs.getStringPref(PREF_FLOORP_CONFIG, "{}"));
  } catch {
    return {};
  }
}

// --- the window -------------------------------------------------------------

type ChromeWindow = Window & {
  delayedStartupPromise: Promise<void>;
  gBrowser: { currentURI: { spec: string; scheme: string } };
};

type XULDocument = Document & {
  createXULElement(tag: string): HTMLElement;
};

type XULBrowser = HTMLElement & {
  loadURI(uri: nsIURI, options: { triggeringPrincipal: nsIPrincipal }): void;
  reload(): void;
  contentTitle: string;
};

type XULPopup = HTMLElement & {
  openPopupAtScreen(x: number, y: number, isContextMenu: boolean): void;
};

const STYLE = `
#nora-webpanel-strip {
  width: 40px;
  min-width: 40px;
  padding: 4px 0;
  align-items: center;
  gap: 2px;
  background-color: var(--toolbar-bgcolor, var(--toolbar-background-color));
  border-inline: 1px solid var(--chrome-content-separator-color, transparent);
}
#nora-webpanel-strip toolbarbutton {
  appearance: none;
  width: 32px;
  height: 32px;
  padding: 6px;
  border-radius: 4px;
  -moz-context-properties: fill;
  fill: currentColor;
}
#nora-webpanel-strip toolbarbutton:hover {
  background-color: var(--toolbarbutton-hover-background, color-mix(in srgb, currentColor 12%, transparent));
}
#nora-webpanel-strip toolbarbutton[selected="true"] {
  background-color: var(--toolbarbutton-active-background, color-mix(in srgb, currentColor 20%, transparent));
}
#nora-webpanel-strip toolbarbutton .toolbarbutton-icon {
  width: 20px;
  height: 20px;
}
#nora-webpanel-box {
  min-width: 200px;
  background-color: var(--toolbar-bgcolor, var(--toolbar-background-color));
}
#nora-webpanel-header {
  align-items: center;
  height: 32px;
  padding: 0 4px 0 10px;
  gap: 4px;
}
#nora-webpanel-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
#nora-webpanel-header toolbarbutton {
  appearance: none;
  padding: 4px;
  border-radius: 4px;
  -moz-context-properties: fill;
  fill: currentColor;
}
#nora-webpanel-header toolbarbutton:hover {
  background-color: color-mix(in srgb, currentColor 12%, transparent);
}
#nora-webpanel-browsers browser {
  flex: 1;
}
#nora-webpanel-browsers browser:not([selected="true"]) {
  visibility: collapse;
}
#nora-webpanel-splitter {
  appearance: none;
  width: 4px;
  min-width: 4px;
  background-color: transparent;
  border: none;
}
#nora-webpanel-splitter:hover {
  background-color: color-mix(in srgb, currentColor 20%, transparent);
}
/* Firefox lays #browser out with CSS order (sidebar 1-4, tabs 5, ai window 6-7); go after them on the right */
#nora-webpanel-splitter[positionend] { order: 8; }
#nora-webpanel-box[positionend] { order: 9; }
#nora-webpanel-strip[positionend] { order: 10; }
`;

async function main(ctx: ContentCtx): Promise<void> {
  const win = window as unknown as ChromeWindow;
  const doc = document as XULDocument;
  // popup windows (window.open with features) have no room for a sidebar
  if ((doc.documentElement.getAttribute("chromehidden") ?? "").includes("toolbar")) return;
  if (doc.getElementById("nora-webpanel-strip")) return;
  await win.delayedStartupPromise;
  const sidebar = new Sidebar(win, doc);
  sidebar.mount();
  // the drop is removed or replaced: take the sidebar out again, this window included
  ctx.onDestroy(() => sidebar.unmount());
}

class Sidebar {
  win: ChromeWindow;
  doc: XULDocument;
  style!: HTMLElement;
  box!: HTMLElement;
  browsers!: HTMLElement;
  splitter!: HTMLElement;
  strip!: HTMLElement;
  title!: HTMLElement;
  menu!: XULPopup;
  menuTarget: string | null = null;
  selected: string | null = null;
  loaded = new Map<string, XULBrowser>();
  prefObserver = { observe: () => this.renderStrip() };

  constructor(win: ChromeWindow, doc: XULDocument) {
    this.win = win;
    this.doc = doc;
  }

  el(tag: string, attrs: Record<string, string> = {}): HTMLElement {
    const e = this.doc.createXULElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  }

  mount(): void {
    this.style = this.doc.createElementNS("http://www.w3.org/1999/xhtml", "style") as HTMLElement;
    this.style.textContent = STYLE;
    this.doc.head.appendChild(this.style);

    // header: title, reload, close
    this.title = this.el("label", { id: "nora-webpanel-title", crop: "end" });
    const reload = this.el("toolbarbutton", {
      image: "chrome://global/skin/icons/reload.svg",
      tooltiptext: "Reload",
    });
    reload.addEventListener("command", () => this.selectedBrowser()?.reload());
    const close = this.el("toolbarbutton", {
      image: "chrome://global/skin/icons/close.svg",
      tooltiptext: "Close",
    });
    close.addEventListener("command", () => this.select(null));
    const header = this.el("hbox", { id: "nora-webpanel-header" });
    header.append(this.title, reload, close);

    this.browsers = this.el("vbox", { id: "nora-webpanel-browsers", flex: "1" });
    this.box = this.el("vbox", { id: "nora-webpanel-box", hidden: "true" });
    this.box.append(header, this.browsers);

    const splitter = this.el("splitter", { id: "nora-webpanel-splitter", hidden: "true" });
    splitter.addEventListener("command", () => this.rememberWidth());
    this.splitter = splitter;

    this.strip = this.el("vbox", { id: "nora-webpanel-strip" });

    // right of the tabs, or left when Floorp's config says so
    const tabbox = this.doc.getElementById("tabbrowser-tabbox")!;
    if (readFloorpConfig().position_start === true) {
      tabbox.before(this.strip, this.box, splitter);
    } else {
      for (const e of [splitter, this.box, this.strip]) e.setAttribute("positionend", "true");
      tabbox.after(splitter, this.box, this.strip);
    }

    this.menu = this.buildMenu();
    this.renderStrip();

    Services.prefs.addObserver(PREF_DATA, this.prefObserver);
    this.win.addEventListener("unload", this.onUnload, { once: true });
  }

  onUnload = () => Services.prefs.removeObserver(PREF_DATA, this.prefObserver);

  /** Everything mount() put in the window, taken out again. The panel list in prefs stays. */
  unmount(): void {
    this.win.removeEventListener("unload", this.onUnload);
    this.onUnload();
    for (const id of [...this.loaded.keys()]) this.unload(id);
    for (const e of [this.menu, this.splitter, this.box, this.strip, this.style]) e.remove();
  }

  buildMenu(): XULPopup {
    const menu = this.el("menupopup", { id: "nora-webpanel-menu" }) as XULPopup;
    const item = (label: string, onCommand: (id: string) => void) => {
      const m = this.el("menuitem", { label });
      m.addEventListener("command", () => {
        if (this.menuTarget) onCommand(this.menuTarget);
      });
      menu.appendChild(m);
    };
    item("Reload", (id) => this.loaded.get(id)?.reload());
    item("Unload", (id) => this.unload(id));
    item("Remove", (id) => {
      this.unload(id);
      writePanels(readPanels().filter((p) => p.id !== id));
    });
    this.doc.getElementById("mainPopupSet")!.appendChild(menu);
    return menu;
  }

  webPanels(): Panel[] {
    return readPanels().filter((p) => p.type === "web" && typeof p.url === "string");
  }

  renderStrip(): void {
    const panels = this.webPanels();
    this.strip.replaceChildren();
    for (const p of panels) {
      const b = this.el("toolbarbutton", {
        image: `page-icon:${p.url}`,
        tooltiptext: p.url ?? "",
      });
      if (p.id === this.selected) b.setAttribute("selected", "true");
      b.addEventListener("command", () => this.select(p.id === this.selected ? null : p.id));
      b.addEventListener("contextmenu", (ev: MouseEvent) => {
        ev.preventDefault();
        this.menuTarget = p.id;
        this.menu.openPopupAtScreen(ev.screenX, ev.screenY, true);
      });
      this.strip.appendChild(b);
    }
    const add = this.el("toolbarbutton", {
      image: "chrome://global/skin/icons/plus.svg",
      tooltiptext: "Add the current tab",
    });
    add.addEventListener("command", () => this.addCurrentTab());
    this.strip.appendChild(add);

    // a panel removed elsewhere (another window): drop its browser too
    for (const id of [...this.loaded.keys()]) {
      if (!panels.some((p) => p.id === id)) this.unload(id);
    }
  }

  addCurrentTab(): void {
    const uri = this.win.gBrowser.currentURI;
    if (uri.scheme !== "http" && uri.scheme !== "https") return;
    const panel: Panel = { id: this.win.crypto.randomUUID(), type: "web", width: 0, url: uri.spec };
    writePanels([...readPanels(), panel]);
    this.select(panel.id);
  }

  select(id: string | null): void {
    this.selected = id;
    const splitter = this.doc.getElementById("nora-webpanel-splitter")!;
    if (id === null) {
      this.box.setAttribute("hidden", "true");
      splitter.setAttribute("hidden", "true");
      for (const b of this.loaded.values()) b.removeAttribute("selected");
      this.renderStrip();
      return;
    }
    const panel = this.webPanels().find((p) => p.id === id);
    if (!panel) return;
    const browser = this.loaded.get(id) ?? this.load(panel);
    for (const [pid, b] of this.loaded) {
      if (pid === id) b.setAttribute("selected", "true");
      else b.removeAttribute("selected");
    }
    this.box.style.width = `${panel.width || readFloorpConfig().globalWidth || DEFAULT_WIDTH}px`;
    this.box.removeAttribute("hidden");
    splitter.removeAttribute("hidden");
    this.title.setAttribute("value", browser.contentTitle || panel.url || "");
    this.renderStrip();
  }

  /** Make the <browser> for a panel (once; it stays until unloaded). Same element Firefox uses for extension sidebars. */
  load(panel: Panel): XULBrowser {
    const browser = this.el("browser", {
      id: `nora-webpanel-${panel.id}`,
      type: "content",
      remote: "true",
      maychangeremoteness: "true",
      messagemanagergroup: "browsers",
      disableglobalhistory: "true",
      tooltip: "aHTMLTooltip",
      autocompletepopup: "PopupAutoComplete",
      contextmenu: "contentAreaContextMenu",
    }) as XULBrowser;
    browser.addEventListener("pagetitlechanged", () => {
      if (this.selected === panel.id) this.title.setAttribute("value", browser.contentTitle || panel.url || "");
    });
    this.browsers.appendChild(browser);
    browser.loadURI(Services.io.newURI(panel.url!), {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
    this.loaded.set(panel.id, browser);
    return browser;
  }

  unload(id: string): void {
    this.loaded.get(id)?.remove();
    this.loaded.delete(id);
    if (this.selected === id) this.select(null);
  }

  selectedBrowser(): XULBrowser | undefined {
    return this.selected ? this.loaded.get(this.selected) : undefined;
  }

  rememberWidth(): void {
    if (!this.selected) return;
    updatePanel(this.selected, { width: Math.round(this.box.getBoundingClientRect().width) });
  }
}
