// SPDX-License-Identifier: MPL-2.0

// std-preact-xul: preact, and one verb, mount.
//
// mount() puts a host element where you say, renders the view into it, and
// puts both ways back on the ledger (ctx.io): when the drop goes, the view is
// unmounted (effects cleaned up, listeners gone) and then the host is taken
// out. A view never renders straight into a box that has other children —
// preact treats those as leftovers and removes them.
//
// Everything mount() puts in the window is also taught to move ATOMICALLY —
// see teachAtomicMove below. In a chrome window that is not a nicety: an
// element that is taken out and put back is destroyed and rebuilt, and some of
// them carry something that cannot be rebuilt.
//
// preact creates children in the host's namespace (render() reads
// parentDom.namespaceURI), so under a XUL host `<vbox>` / `<toolbarbutton>`
// are real XUL elements and under an HTML host `<div>` is HTML. Pick the host
// tag for the tree you want.
//
// This preact is bundled here from its source; a drop that depends on std
// gets this one copy, loaded into its own scope.

import { render, type ComponentChild } from "preact";
import { useLayoutEffect, useReducer } from "preact/hooks";
import type { ReadonlySignal } from "@preact/signals-core";

/** The shape of ctx.io that mount needs (defined by the drop tooling's _shared/io.ts). */
export interface IoLike {
  place(node: Node, at: { parent: Node } | { before: Node } | { after: Node }): void;
  defer(fn: () => void): void;
}

const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const XHTML_NS = "http://www.w3.org/1999/xhtml";

export type MountAt = ({ parent: Node } | { before: Node } | { after: Node }) & {
  /** The host element: a XUL tag (default "vbox"), or "html:div" for an HTML host. */
  tag?: string;
  id?: string;
};

/** Put a host where `at` says, render `view` into it, and remember to take both out. */
export function mount(io: IoLike, view: ComponentChild, at: MountAt): Element {
  const anchor = ("parent" in at ? at.parent : "before" in at ? at.before : at.after) as Node;
  const doc = anchor.ownerDocument ?? (anchor as Document);
  const tag = at.tag ?? "vbox";
  const host = tag.startsWith("html:")
    ? doc.createElementNS(XHTML_NS, tag.slice(5))
    : (doc as any).createXULElement?.(tag) ?? doc.createElementNS(XUL_NS, tag);
  if (at.id) host.id = at.id;
  teachAtomicMove(host);
  io.place(host, at);
  render(view, host);
  io.defer(() => render(null, host));
  return host;
}

const TAUGHT = Symbol("atomic move");

/**
 * When preact puts an element it has already placed somewhere else, it calls
 * `parent.insertBefore(el, ref)` — and in the DOM that is not a move: the node
 * is taken OUT and then put back. For a plain <label> nothing is lost. For the
 * things a chrome window holds, the taking-out is the whole story:
 *
 *   <browser>   the page is destroyed and reloaded (a fresh browsingContext —
 *               so scroll, form, history, everything that was on it, gone)
 *   <input>     focus and the caret go
 *   <video>     playback restarts
 *
 * `moveBefore` is the same edit without the taking-out (the DOM's own
 * state-preserving move; <browser> has a `connectedMoveCallback` for exactly
 * this). preact has one insertion call site and it calls it on the PARENT, so
 * giving every element this drop puts in the window its own `insertBefore` is
 * enough to cover all of them. Nothing outside what mount() placed is touched.
 *
 * A node that isn't in the document yet can't be "moved" — moveBefore throws
 * HierarchyRequestError — so a freshly built subtree simply takes the ordinary
 * path, which is what it wants anyway.
 */
function teachAtomicMove(node: Node): void {
  const n = node as Node & { [TAUGHT]?: boolean; moveBefore?: (k: Node, r: Node | null) => void };
  if (n[TAUGHT] || typeof n.moveBefore !== "function") return;
  n[TAUGHT] = true;
  (n as unknown as { insertBefore: unknown }).insertBefore = function <T extends Node>(
    this: Node & { moveBefore(k: Node, r: Node | null): void },
    kid: T,
    ref: Node | null,
  ): T {
    teachSubtree(kid);
    if (kid.isConnected) {
      try {
        this.moveBefore(kid, ref ?? null);
        return kid;
      } catch {
        // not movable from where it stands (another document, a detached
        // parent): fall through and do it the way it was always done
      }
    }
    return Node.prototype.insertBefore.call(this, kid, ref ?? null) as T;
  };
}

/** The node and everything under it: preact builds a subtree before it places it. */
function teachSubtree(node: Node): void {
  teachAtomicMove(node);
  const el = node as Element;
  if (typeof el.querySelectorAll !== "function") return;
  for (const kid of el.querySelectorAll("*")) teachAtomicMove(kid);
}

/**
 * Read a signal in a view and redraw when it changes. (The @preact/signals
 * package would do this by itself, but it hooks preact by its minified internal
 * names and this preact is bundled from source; signals-core plus this hook is
 * the honest version.)
 *
 * useLayoutEffect, not useEffect, and that is not a detail: an ordinary effect
 * is flushed AFTER the paint (a frame, or 100ms if no frame comes), and a value
 * written into the signal before then is read by nobody -- subscribe() hands the
 * new value straight to the callback that swallows its first call, and the view
 * quietly keeps showing the old one until something else changes. A drop whose
 * first frame asks a question (Ask / Measure) answers itself in far less than a
 * frame, so this was not a rare race; it was the ordinary case. A layout effect
 * runs inside the commit, so the subscription exists before render() returns.
 */
export function useSignalValue<T>(s: ReadonlySignal<T>): T {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useLayoutEffect(() => {
    let first = true;
    return s.subscribe(() => {
      if (first) first = false; // subscribe() calls once right away with the value we already have
      else redraw(0);
    });
  }, [s]);
  return s.value;
}

export * from "preact";
export * from "preact/hooks";
export { jsx, jsxDEV, jsxs } from "preact/jsx-runtime";
export { batch, computed, effect, signal, type ReadonlySignal, type Signal } from "@preact/signals-core";
