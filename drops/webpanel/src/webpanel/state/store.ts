// SPDX-License-Identifier: MPL-2.0
// The one way anything changes: hand an action to the logic (Tsubaki), put the
// view it answers with where the drawing can see it, then carry out the effects.
//
// The logic is a process away (see the drop tooling's ops page: wasm can't
// compile in the parent process, where this window lives), so a dispatch is a
// message and the answer arrives later. Nothing here waits for it -- the view
// is a signal, and it changes when the frame comes back.

import { signal } from "std";
import type { Ops } from "../../_shared/defineActor.ts";
import type { Action, Effect, Frame } from "../types/view.ts";

/** The latest view, as data. ui/View.tsx turns it into elements. */
export const view = signal<Frame["view"] | null>(null);

let ops: Ops | null = null;
let run: (e: Effect) => void = () => {};

/** The shell wires this once: the doors, who carries effects out, and the first frame. */
export function attach(o: Ops, perform: (e: Effect) => void, first: Frame): void {
  ops = o;
  run = perform;
  take(first);
}

export function dispatch(action: Action): void {
  if (!ops) return;
  ops.call("dispatch", action).then(
    (frame) => take(frame as Frame),
    (e) => console.error("[webpanel] dispatch failed:", action.__type, e),
  );
}

// The view goes up BEFORE the effects run, because an effect may dispatch again
// (showing a panel tells us the page's title) and that inner frame has to be the
// one that stays -- it comes back after this one either way.
function take(frame: Frame): void {
  view.value = frame.view;
  for (const e of frame.effects) run(e);
}
