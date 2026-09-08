// SPDX-License-Identifier: MPL-2.0
// The translator: a VNode (data) becomes elements, and an "on:*" prop becomes a
// listener that hands its action back. It decides nothing on its own. The only
// thing it adds is what the logic cannot know: a fresh uuid, the current tab's
// URL, the width the box actually ended up, where on the screen a click was.

import { Fragment, h, useSignalValue, type ComponentChild } from "std";
import type { Action, VNode } from "../types/view.ts";
import type { ChromeWindow } from "../types/panel.ts";
import { dispatch, view } from "../state/store.ts";
import { attach } from "../io/browsers.ts";

/** The box element, kept so a finished drag can be measured. */
const box = { current: null as HTMLElement | null };

// Kept still on purpose: preact calls a ref that CHANGED with null first, and a
// fresh closure every render would mean handing the browsers box back as null on
// every redraw -- which takes every <browser> out with it.
const REFS: Record<string, (el: Element | null) => void> = {
  browsers: (el) => attach(el as HTMLElement | null),
  box: (el) => void (box.current = el as HTMLElement | null),
};

export function Sidebar(props: { win: ChromeWindow }) {
  const v = useSignalValue(view);
  return v ? toPreact(v.sidebar, props.win) : null;
}

export function Menu(props: { win: ChromeWindow }) {
  const v = useSignalValue(view);
  return v ? toPreact(v.menu, props.win) : null;
}

function toPreact(node: VNode | string, win: ChromeWindow): ComponentChild {
  if (typeof node === "string") return node;
  const props: Record<string, unknown> = {};
  for (const key of Object.keys(node.props)) {
    const value = node.props[key];
    if (value === null || value === undefined) continue;
    if (key.startsWith("on:")) {
      const action = plain(value as Action);
      props[`on${key.slice(3)}`] = (ev: Event) => raise(action, ev, win);
    } else if (key === "ref") {
      props.ref = REFS[value as string];
    } else if (key === "width") {
      if ((value as number) > 0) props.style = { width: `${value as number}px` };
    } else {
      props[key] = value;
    }
  }
  return h(
    node.tag === "fragment" ? Fragment : node.tag,
    props,
    node.kids.map((kid) => toPreact(kid, win)),
  );
}

function raise(action: Action, ev: Event, win: ChromeWindow): void {
  if (action.__type === "AddPanel") {
    const uri = win.gBrowser.currentURI;
    if (uri.scheme !== "http" && uri.scheme !== "https") return;
    dispatch({ __type: "AddPanel", id: win.crypto.randomUUID(), url: uri.spec });
    return;
  }
  if (action.__type === "SetWidth") {
    if (!box.current) return;
    dispatch({ __type: "SetWidth", width: Math.round(box.current.getBoundingClientRect().width) });
    return;
  }
  if (action.__type === "OpenMenu") {
    const at = ev as MouseEvent;
    at.preventDefault();
    dispatch({ __type: "OpenMenu", id: action.id, x: at.screenX, y: at.screenY });
    return;
  }
  dispatch(action);
}

/** A copy this side owns: what comes out of the sandbox is only read through. */
function plain(a: Action): Action {
  const out: Action = { __type: a.__type };
  for (const key of Object.keys(a)) out[key] = a[key];
  return out;
}
