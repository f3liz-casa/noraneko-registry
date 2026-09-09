// SPDX-License-Identifier: MPL-2.0

// A view that came from the logic as data, turned into elements.
//
// The logic (ops/*.tsubaki) answers with a tree of `VNode(tag, props, kids)` and
// never touches the DOM: it cannot, it runs in a worker. This is the translator,
// and it decides nothing. An `"on:*"` prop is not a closure -- closures do not
// cross a postMessage -- it is the *action to raise*, handed back to dispatch as
// it is, with the few facts only this side can know (where the click was, what
// the field says) alongside it.

import { Fragment, h, type ComponentChild } from "std";

export interface VNode {
  tag: string;
  props: Record<string, unknown>;
  kids: (VNode | string)[];
}
export interface Action {
  __type: string;
  [field: string]: unknown;
}

/** What only this side can know about the event that raised an action. */
export interface EventFacts {
  screenX?: number;
  screenY?: number;
  value?: string;
  checked?: boolean;
  key?: string;
}

export function toPreact(node: VNode | string, dispatch: (a: Action) => void): ComponentChild {
  if (typeof node === "string") return node;
  const props: Record<string, unknown> = {};
  for (const key of Object.keys(node.props)) {
    const value = node.props[key];
    if (value === null || value === undefined) continue;
    if (key.startsWith("on:")) {
      // a copy this side owns: what comes out of the worker is only read through
      const action = { ...(value as Action) };
      props[`on${key.slice(3)}`] = (ev: Event) => dispatch({ ...action, __event: factsOf(ev) });
    } else {
      props[key] = value;
    }
  }
  return h(
    node.tag === "fragment" ? Fragment : node.tag,
    props,
    node.kids.map((kid) => toPreact(kid, dispatch)),
  );
}

function factsOf(ev: Event): EventFacts {
  const facts: EventFacts = {};
  const m = ev as MouseEvent;
  if (typeof m.screenX === "number") {
    facts.screenX = Math.round(m.screenX);
    facts.screenY = Math.round(m.screenY);
  }
  const t = ev.target as { value?: unknown; checked?: unknown } | null;
  if (t && typeof t.value === "string") facts.value = t.value;
  if (t && typeof t.checked === "boolean") facts.checked = t.checked;
  const k = ev as KeyboardEvent;
  if (typeof k.key === "string") facts.key = k.key;
  return facts;
}
