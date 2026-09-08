// SPDX-License-Identifier: MPL-2.0

// The ui layer of a content hook: preact, with `xul:` tags that become real XUL
// elements (the same trick as noraneko's libs/preact-xul), and one verb, mount.
//
// mount() puts a host element where you say, renders the view into it, and
// puts both ways back on the ledger: when the drop goes, the view is unmounted
// (effects cleaned up, listeners gone) and then the host is taken out. A view
// never renders straight into a box that has other children — preact treats
// those as leftovers and removes them.
//
// This preact is bundled from its source into each drop's content.js, so the
// options.vnode hook below only touches this drop's copy.

import { options, render, type ComponentChild, type Ref, type VNode } from "preact";
import type { Io } from "./io.ts";

const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

const createXul = (doc: Document, tag: string) =>
  (doc as any).createXULElement?.(tag) ?? doc.createElementNS(XUL_NS, tag);

const migrate = (from: Element, to: Element) => {
  Array.from(from.attributes).forEach((a) => to.setAttribute(a.name, a.value));
  while (from.firstChild) to.appendChild(from.firstChild);
  return Object.assign(to, { __isXUL: true });
};

const materialize = (el: Element, tag: string) => {
  const xul = migrate(el, createXul(el.ownerDocument, tag));
  el.parentNode?.replaceChild(xul, el);
  return xul;
};

const commit = <T>(ref: Ref<T> | undefined, val: T | null) =>
  typeof ref === "function" ? ref(val) : ref && (ref.current = val);

const liftRef = (tag: string, orig?: Ref<any>) => (el: Element | null) => {
  if (!el) return commit(orig, el);
  if ((el as any).__isXUL) return commit(orig, el);
  return commit(orig, materialize(el, tag));
};

const patch = (vnode: VNode) => {
  if (typeof vnode.type === "string" && vnode.type.startsWith("xul:")) {
    vnode.ref = liftRef((vnode.type = vnode.type.slice(4)), vnode.ref);
  }
};

// The hook goes in on the first mount, not at module load: the parent bundle
// imports this module too (through actor.ts) and must be able to drop it.
let hooked = false;
function hook(): void {
  if (hooked) return;
  hooked = true;
  const prev = options.vnode;
  options.vnode = (v) => (patch(v), prev?.(v));
}

export type MountAt = ({ parent: Node } | { before: Node } | { after: Node }) & {
  /** The host element: a XUL tag (default "vbox"), or "html:div" for an HTML host. */
  tag?: string;
  id?: string;
};

/** Put a host where `at` says, render `view` into it, and remember to take both out. */
export function mount(io: Io, view: ComponentChild, at: MountAt): Element {
  const anchor = ("parent" in at ? at.parent : "before" in at ? at.before : at.after) as Node;
  const doc = anchor.ownerDocument ?? (anchor as Document);
  const tag = at.tag ?? "vbox";
  const host = tag.startsWith("html:")
    ? doc.createElementNS("http://www.w3.org/1999/xhtml", tag.slice(5))
    : createXul(doc, tag);
  if (at.id) host.id = at.id;
  hook();
  io.place(host, at);
  render(view, host);
  io.defer(() => render(null, host));
  return host;
}

export * from "preact";
