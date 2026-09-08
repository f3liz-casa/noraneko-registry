// SPDX-License-Identifier: MPL-2.0
// The shapes that cross the boundary with ops/webpanel.tsubaki. All of them are
// plain data: a struct comes over as { __type, ...fields }, a Dict as an object.

/** What happened. Made by the view (as the value of an "on:*" prop) or by this side. */
export interface Action {
  __type: string;
  [field: string]: unknown;
}

/** What to do about it. Carried out in io/perform.ts, nowhere else. */
export interface Effect {
  __type: string;
  [field: string]: unknown;
}

/** A node of the view: a tag, its props, its children. No DOM, no preact. */
export interface VNode {
  __type: "VNode";
  tag: string;
  props: Record<string, unknown>;
  kids: (VNode | string)[];
}

/** What both doors (`start`, `dispatch`) answer with. */
export interface Frame {
  view: { sidebar: VNode; menu: VNode };
  effects: Effect[];
}
