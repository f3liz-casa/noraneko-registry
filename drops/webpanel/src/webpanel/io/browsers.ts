// SPDX-License-Identifier: MPL-2.0
// The <browser> elements, made by hand: they want their attributes before they
// connect and they carry live state (a loaded page), so preact is not asked to
// look after them. They live in the box the view draws (#nora-webpanel-browsers,
// handed over by its ref); the logic only ever names them by id.

import type { XULBrowser } from "../types/panel.ts";
import { dispatch } from "../state/store.ts";

const loaded = new Map<string, XULBrowser>();
let box: HTMLElement | null = null;

/** The view's browsers box, as preact made it (null when it goes away). */
export function attach(el: HTMLElement | null): void {
  box = el;
  if (el === null) {
    for (const b of loaded.values()) b.remove();
    loaded.clear();
  }
}

/** Show this panel: made on first sight, then kept until it is dropped. */
export function show(id: string, url: string): void {
  const browser = loaded.get(id) ?? load(id, url);
  for (const [other, b] of loaded) {
    if (other === id) b.setAttribute("selected", "true");
    else b.removeAttribute("selected");
  }
  dispatch({ __type: "SetTitle", id, title: browser.contentTitle || url });
}

export function hideAll(): void {
  for (const b of loaded.values()) b.removeAttribute("selected");
}

export function reload(id: string): void {
  loaded.get(id)?.reload();
}

export function drop(id: string): void {
  loaded.get(id)?.remove();
  loaded.delete(id);
}

function load(id: string, url: string): XULBrowser {
  const doc = box!.ownerDocument as Document & { createXULElement(tag: string): HTMLElement };
  const browser = doc.createXULElement("browser") as XULBrowser;
  const attrs: Record<string, string> = {
    id: `nora-webpanel-${id}`,
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
    dispatch({ __type: "SetTitle", id, title: browser.contentTitle || url });
  });
  box!.appendChild(browser);
  browser.loadURI(Services.io.newURI(url), {
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
  });
  loaded.set(id, browser);
  return browser;
}
