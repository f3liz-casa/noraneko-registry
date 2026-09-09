// SPDX-License-Identifier: MPL-2.0

// example: the smallest drop that draws something. One line at the bottom of
// about:newtab, from a preact view. Copy this dir to start your own.
//
// Everything placed in the page goes through ctx.io / mount, so when the drop
// is removed the line goes away with it — there is no cleanup to write.
//
// Where things go, when this grows: what TOUCHES the window goes in io/, what
// DECIDES goes in a .tsubaki file (pure -- it never sees the window), and the
// rest stays flat next to this file. Types live in the file that uses them,
// constants next to whatever reads them. That is the whole rule (docs/LAYERS.md).
//
// A drop that only draws and only reads prefs need not be TypeScript at all:
// see drops/hello-tsubaki, which is one .tsubaki file and no JS (GUIDE, 3.5).

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
