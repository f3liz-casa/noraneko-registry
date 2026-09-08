// SPDX-License-Identifier: MPL-2.0

// example: the smallest drop that draws something. One line at the bottom of
// about:newtab, from a preact view. Copy this dir to start your own.
//
// Everything placed in the page goes through ctx.io / mount, so when the drop
// is removed the line goes away with it — there is no cleanup to write.
//
// Layers (make only the dirs you need; a small drop is just actor.ts + ui/):
//   types/  what the data looks like       ops/    pure functions (lists in, lists out)
//   data/   constants, pref names          io/     side effects: prefs, DOM, <browser>s
//   state/  signals the view reads         ui/     preact views
// drops/webpanel is the one with all six.

import {
  defineContent,
  defineParent,
  type ActorMeta,
} from "../_shared/defineActor.ts";
import { h, mount } from "../_shared/ui.ts";
import { Hello } from "./ui/Hello.tsx";

export const meta: ActorMeta = {
  id: "example@noraneko.app",
  version: "1.0.0",
  namespace: "noraExample",
  matches: ["about:newtab*"],
  runAt: "document_end",
};

// Nothing is asked of the main process. (A method here can be called from the
// content hook as `parent.method()`; it runs in the main process.)
export const parent = defineParent({});

export const content = defineContent<typeof parent>((_parent, ctx) => {
  mount(ctx.io, h(Hello, { name: "example" }), { parent: document.body, tag: "html:div" });
});
