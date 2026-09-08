// SPDX-License-Identifier: MPL-2.0
// The <browser> elements, made by hand: they want their attributes before they
// connect and carry live state (a loaded page), so preact is not asked to
// manage them. They live inside the box preact draws; attach() hands that box over.

import type { Panel, XULBrowser } from "../types/panel.ts";
import { selected, title } from "../state/store.ts";

export class Browsers {
  #box: HTMLElement | null = null;
  #loaded = new Map<string, XULBrowser>();

  attach(box: HTMLElement): void {
    this.#box = box;
  }

  /** The box is going away: take every browser out with it. */
  detach(): void {
    for (const b of this.#loaded.values()) b.remove();
    this.#loaded.clear();
    this.#box = null;
  }

  ids(): string[] {
    return [...this.#loaded.keys()];
  }

  /** Show this panel's browser (made on first show; it stays until unloaded). Same element Firefox uses for extension sidebars. */
  show(panel: Panel): void {
    const browser = this.#loaded.get(panel.id) ?? this.#load(panel);
    for (const [id, b] of this.#loaded) {
      if (id === panel.id) b.setAttribute("selected", "true");
      else b.removeAttribute("selected");
    }
    title.value = browser.contentTitle || panel.url || "";
  }

  hideAll(): void {
    for (const b of this.#loaded.values()) b.removeAttribute("selected");
    title.value = "";
  }

  reload(id: string): void {
    this.#loaded.get(id)?.reload();
  }

  unload(id: string): void {
    this.#loaded.get(id)?.remove();
    this.#loaded.delete(id);
  }

  #load(panel: Panel): XULBrowser {
    const doc = this.#box!.ownerDocument as Document & { createXULElement(tag: string): HTMLElement };
    const browser = doc.createXULElement("browser") as XULBrowser;
    const attrs: Record<string, string> = {
      id: `nora-webpanel-${panel.id}`,
      type: "content",
      remote: "true",
      maychangeremoteness: "true",
      messagemanagergroup: "browsers",
      disableglobalhistory: "true",
      tooltip: "aHTMLTooltip",
      autocompletepopup: "PopupAutoComplete",
      contextmenu: "contentAreaContextMenu",
    };
    for (const [k, v] of Object.entries(attrs)) browser.setAttribute(k, v);
    browser.addEventListener("pagetitlechanged", () => {
      if (selected.value === panel.id) title.value = browser.contentTitle || panel.url || "";
    });
    this.#box!.appendChild(browser);
    browser.loadURI(Services.io.newURI(panel.url!), {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
    this.#loaded.set(panel.id, browser);
    return browser;
  }
}
