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
// A Frame is Dict("view" => …, "effects" => [...]). The view is one VNode when
// there is one place to put it, or Dict(anchor の名前 => VNode) when setup asked
// for several (a strip beside the tabs AND a <menupopup> under #mainPopupSet
// cannot be one tree: they live in different parts of the window).
//
// Effects are data, made there and carried out here -- `perform` below is the
// whole vocabulary, and it is meant to stay small: a drop that needs more than
// this writes an actor.ts (that door is not closing).
//
// Two of them are the logic asking a question rather than giving an order.
// `Ask` and `Measure` exist because a rule the logic keeps is that it never
// makes a fact: a fresh uuid, the URL of the tab you are on, the width a box
// actually ended up after a drag. So instead of the shell quietly filling a
// hole in an action, the logic says which facts it wants and what to call the
// action they come back in -- and the answer arrives as an ordinary dispatch,
// the same door everything else from outside comes through.
//
// Everything placed goes through ctx.io / mount, so removing the drop takes the
// views, the style and the pref observers back out by itself.

import { h, mount, signal, useSignalValue, type ReadonlySignal } from "std";
import type { ContentCtx } from "./defineActor.ts";
import { toPreact, type Action, type VNode } from "./vnode.ts";

interface Anchor {
  /** the name `view` answers with when there are several. The only one may leave it out ("main"). */
  name?: string;
  /** where, relative to what the selector found: after / before / inside it */
  at?: "after" | "before" | "parent";
  /** a CSS selector in this document. Defaults to "body". */
  selector?: string;
  /** the host element's tag ("vbox", "hbox", "menupopup", "html:div", ...) */
  tag?: string;
  id?: string;
}
interface Setup {
  /** one place for the view. `anchors` says it for several. */
  anchor?: Anchor;
  anchors?: Anchor[];
  style?: string;
  /** prefs to read at start and follow: a change raises PrefChanged(name, value) */
  prefs?: string[];
}
interface Frame {
  /** one VNode (it goes to the first anchor), or the anchor's name => its VNode */
  view: VNode | Record<string, VNode | null> | null;
  effects?: Action[];
}

export async function runTsubakiActor(ctx: ContentCtx, files: string[]): Promise<void> {
  const ops = ctx.ops;
  if (!ops) throw new Error("a Tsubaki actor needs std's runtime (ctx.ops)");
  for (const file of files) await ops.load(file);

  const setup = ((await ops.call("setup")) ?? {}) as Setup;
  const anchors = setup.anchors ?? [setup.anchor ?? {}];
  const names = anchors.map((a, i) => {
    if (a.name) return a.name;
    if (anchors.length === 1) return "main";
    throw new Error(`setup: anchors[${i}] に "name" が無い(view はその名前で答える)`);
  });
  // one signal, one entry per anchor: a frame is one view of the whole drop,
  // even when it is drawn in two places
  const views = signal<Record<string, VNode | null>>({});
  const hosts: Element[] = [];

  const dispatch = (action: Action): void => {
    ops.call("dispatch", action).then(
      (frame) => take(frame as Frame),
      (e) => console.error("[tsubaki-actor] dispatch failed:", action.__type, e),
    );
  };
  // the view goes up BEFORE the effects run: an effect may dispatch again, and
  // that inner frame has to be the one that stays
  const take = (frame: Frame): void => {
    views.value = spread(frame.view, names[0]);
    for (const effect of frame.effects ?? []) perform(effect);
  };

  /** The whole vocabulary of "do this" a Tsubaki actor has. Anything else: write an actor.ts. */
  const perform = (effect: Action): void => {
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
      case "Ask": {
        const action: Action = { __type: String(effect.action) };
        for (const field of asStrings(effect.fields)) action[field] = factOf(field);
        dispatch(action);
        return;
      }
      case "Measure": {
        // after preact has drawn the frame we just put up: the redraw was queued
        // as a microtask when views.value was set, so this one runs behind it.
        // It is also what lets the FIRST frame ask -- the hosts are mounted
        // further down, still inside this same turn.
        queueMicrotask(() => {
          const el = look(hosts, String(effect.selector));
          if (!el) {
            console.warn("[tsubaki-actor] Measure: 見つからない:", effect.selector);
            return;
          }
          const box = el.getBoundingClientRect();
          dispatch({
            __type: String(effect.action),
            width: Math.round(box.width),
            height: Math.round(box.height),
          });
        });
        return;
      }
      case "Log":
        console.log("[tsubaki-actor]", effect.text);
        return;
      default:
        console.warn("[tsubaki-actor] 知らない effect:", effect.__type);
    }
  };

  const watched = setup.prefs ?? [];
  take((await ops.call("start", { prefs: readPrefs(watched), url: String(document.location?.href ?? "") })) as Frame);

  if (setup.style) ctx.io.style(document, setup.style);
  for (const name of watched) {
    ctx.io.pref(name, () => dispatch({ __type: "PrefChanged", name, value: readPref(name) }));
  }
  for (const [i, anchor] of anchors.entries()) {
    hosts.push(mount(ctx.io, h(View, { views, name: names[i], dispatch }), placeOf(anchor)));
  }
}

function View(props: {
  views: ReadonlySignal<Record<string, VNode | null>>;
  name: string;
  dispatch: (a: Action) => void;
}) {
  const v = useSignalValue(props.views)[props.name];
  return v ? toPreact(v, props.dispatch) : null;
}

/** A frame's view as "which anchor gets what". One VNode goes to the first anchor. */
function spread(view: Frame["view"], first: string): Record<string, VNode | null> {
  if (!view) return {};
  if (typeof (view as VNode).tag === "string") return { [first]: view as VNode };
  return { ...(view as Record<string, VNode | null>) };
}

/** Where a host goes. The selector is looked up in this document; "body" by default. */
function placeOf(anchor: Anchor): Parameters<typeof mount>[2] {
  const selector = anchor.selector ?? "body";
  const el = document.querySelector(selector);
  if (!el) throw new Error(`anchor not found: ${selector}`);
  const tag = anchor.tag ?? (el.namespaceURI?.includes("there.is.only.xul") ? "vbox" : "html:div");
  const id = anchor.id;
  if (anchor.at === "after") return { after: el, tag, id };
  if (anchor.at === "before") return { before: el, tag, id };
  return { parent: el, tag, id };
}

/**
 * The selector, looked for inside what this drop put in the window -- its own
 * hosts and their children, never the rest of the browser. A drop measures what
 * it drew.
 */
function look(hosts: Element[], selector: string): Element | null {
  for (const host of hosts) {
    if (host.matches(selector)) return host;
    const found = host.querySelector(selector);
    if (found) return found;
  }
  return null;
}

/** A fact only this side can know, by the name the logic asked for. */
function factOf(field: string): unknown {
  switch (field) {
    case "uuid":
      return crypto.randomUUID();
    case "url": {
      // the tab you are looking at when this is a browser window; otherwise this
      // document. "" when it is not a web page -- an about: or a file: URL is
      // not something a drop should be handed by asking
      const win = window as unknown as { gBrowser?: { currentURI?: { spec?: string } } };
      const url = win.gBrowser?.currentURI?.spec ?? String(document.location?.href ?? "");
      return /^https?:\/\//.test(url) ? url : "";
    }
    default:
      console.warn("[tsubaki-actor] Ask: 知らない事実:", field);
      return null;
  }
}

function asStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.map(String) : [];
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
