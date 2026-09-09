// SPDX-License-Identifier: MPL-2.0

// A drop whose actor is written in Tsubaki: no actor.ts at all, just
// ops/*.tsubaki and the `[actor]` table in drop.toml. This is the shell the
// build puts around it -- the same shell for every such drop, so what a
// reviewer reads is the drop's own words and not its plumbing.
//
// The three doors the logic answers:
//
//   setup()           -> Dict: where to put the view, its style, which prefs to follow
//   start(facts)      -> Frame: the first view (facts = what was already true)
//   dispatch(action)  -> Frame: the next view, and what to do about it
//
// A Frame is Dict("view" => VNode, "effects" => [...]). Effects are data, made
// there and carried out here -- `perform` below is the whole vocabulary, and it
// is meant to stay small: a drop that needs more than this writes an actor.ts
// (that door is not closing).
//
// Everything placed goes through ctx.io / mount, so removing the drop takes the
// view, the style and the pref observers back out by itself.

import { h, mount, signal, useSignalValue, type ReadonlySignal } from "std";
import type { ContentCtx } from "./defineActor.ts";
import { toPreact, type Action, type VNode } from "./vnode.ts";

interface Anchor {
  /** where, relative to what the selector found: after / before / inside it */
  at?: "after" | "before" | "parent";
  /** a CSS selector in this document. Defaults to "body". */
  selector?: string;
  /** the host element's tag ("vbox", "hbox", "html:div", ...) */
  tag?: string;
  id?: string;
}
interface Setup {
  anchor?: Anchor;
  style?: string;
  /** prefs to read at start and follow: a change raises PrefChanged(name, value) */
  prefs?: string[];
}
interface Frame {
  view: VNode;
  effects?: Action[];
}

export async function runTsubakiActor(ctx: ContentCtx, files: string[]): Promise<void> {
  const ops = ctx.ops;
  if (!ops) throw new Error("a Tsubaki actor needs std's runtime (ctx.ops)");
  for (const file of files) await ops.load(file);

  const setup = ((await ops.call("setup")) ?? {}) as Setup;
  const view = signal<VNode | null>(null);

  const dispatch = (action: Action): void => {
    ops.call("dispatch", action).then(
      (frame) => take(frame as Frame),
      (e) => console.error("[tsubaki-actor] dispatch failed:", action.__type, e),
    );
  };
  // the view goes up BEFORE the effects run: an effect may dispatch again, and
  // that inner frame has to be the one that stays
  const take = (frame: Frame): void => {
    view.value = frame.view;
    for (const effect of frame.effects ?? []) perform(effect);
  };

  const watched = setup.prefs ?? [];
  take((await ops.call("start", { prefs: readPrefs(watched), url: String(document.location?.href ?? "") })) as Frame);

  if (setup.style) ctx.io.style(document, setup.style);
  for (const name of watched) {
    ctx.io.pref(name, () => dispatch({ __type: "PrefChanged", name, value: readPref(name) }));
  }
  mount(ctx.io, h(View, { view, dispatch }), placeOf(setup.anchor));
}

function View(props: { view: ReadonlySignal<VNode | null>; dispatch: (a: Action) => void }) {
  const v = useSignalValue(props.view);
  return v ? toPreact(v, props.dispatch) : null;
}

/** Where the host goes. The selector is looked up in this document; "body" by default. */
function placeOf(anchor: Anchor | undefined): Parameters<typeof mount>[2] {
  const a = anchor ?? {};
  const selector = a.selector ?? "body";
  const el = document.querySelector(selector);
  if (!el) throw new Error(`anchor not found: ${selector}`);
  const tag = a.tag ?? (el.namespaceURI?.includes("there.is.only.xul") ? "vbox" : "html:div");
  const id = a.id;
  if (a.at === "after") return { after: el, tag, id };
  if (a.at === "before") return { before: el, tag, id };
  return { parent: el, tag, id };
}

/** The whole vocabulary of "do this" a Tsubaki actor has. Anything else: write an actor.ts. */
function perform(effect: Action): void {
  switch (effect.__type) {
    case "SetPref":
      writePref(String(effect.name), effect.value);
      return;
    case "OpenURL": {
      const win = window as unknown as { openWebLinkIn?: (url: string, where: string) => void };
      const url = String(effect.url);
      if (!/^https?:\/\//.test(url)) return; // 開くのは web の URL だけ
      if (win.openWebLinkIn) win.openWebLinkIn(url, "tab");
      else window.open(url, "_blank");
      return;
    }
    case "Log":
      console.log("[tsubaki-actor]", effect.text);
      return;
    default:
      console.warn("[tsubaki-actor] 知らない effect:", effect.__type);
  }
}

function readPrefs(names: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of names) out[name] = readPref(name);
  return out;
}
/** The pref as it is: its type in about:config decides. Absent is `nothing` on the other side. */
function readPref(name: string): boolean | number | string | null {
  switch (Services.prefs.getPrefType(name)) {
    case Services.prefs.PREF_BOOL:
      return Services.prefs.getBoolPref(name, false);
    case Services.prefs.PREF_INT:
      return Services.prefs.getIntPref(name, 0);
    case Services.prefs.PREF_STRING:
      return Services.prefs.getStringPref(name, "");
    default:
      return null;
  }
}
function writePref(name: string, value: unknown): void {
  if (typeof value === "boolean") Services.prefs.setBoolPref(name, value);
  else if (typeof value === "number") Services.prefs.setIntPref(name, Math.round(value));
  else if (typeof value === "string") Services.prefs.setStringPref(name, value);
  else console.warn("[tsubaki-actor] SetPref: bool / int / string のどれかで:", name, value);
}
