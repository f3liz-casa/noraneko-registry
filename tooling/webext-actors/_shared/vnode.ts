// SPDX-License-Identifier: MPL-2.0

// A view that came from the logic as data, turned into elements.
//
// The logic (ops/*.tsubaki) answers with a tree of `VNode(tag, props, kids)` and
// never touches the DOM: it cannot, it runs in a worker. This is the translator,
// and it decides nothing. An `"on:*"` prop is not a closure -- closures do not
// cross a postMessage -- it is the *action to raise*, handed back to dispatch as
// it is, with the few facts only this side can know (where the click was, what
// the field says) alongside it.
//
// It does hold one line, though: WHICH TAGS a view may name. The promise a drop
// makes to whoever installs it is "the effects are the whole list of what this
// can do", and that promise is only true if the elements are inert -- boxes,
// labels, buttons, menu rows. An element that loads a page is not inert, so it
// is not in ELEMENTS; a drop that wants one says so in drop.toml (`web_frame`)
// and the shell dresses it here, rather than the drop's own words deciding what
// kind of window it gets.

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

/** What this drop declared in drop.toml, beyond the ordinary vocabulary. */
export interface ViewPolicy {
  /** `[actor] web_frame = true`: the view may say `browser` (a window that loads a web page) */
  webFrame?: boolean;
}

/** What only this side can know about the event that raised an action. */
export interface EventFacts {
  screenX?: number;
  screenY?: number;
  value?: string;
  checked?: boolean;
  key?: string;
}

/**
 * The tags a view may name. The namespace is the host's, so one name covers
 * both spellings where they agree (`label`, `button` are XUL under a XUL host
 * and HTML under an HTML one) -- pick the host's tag in `setup`'s anchor.
 *
 * Everything here is inert: it draws, it holds text, it can be clicked. Nothing
 * here loads anything, runs anything, or reaches outside the window. Growing
 * this list is a PR to the registry, read by the same people who read the drops.
 */
const ELEMENTS = new Set([
  // XUL: boxes and the things that sit in them
  "vbox", "hbox", "box", "stack", "deck", "spacer", "separator", "splitter",
  "groupbox", "caption", "scrollbox", "arrowscrollbox", "resizer", "dropmarker",
  "label", "description", "image", "toolbarbutton", "toolbarseparator", "toolbaritem",
  "tabbox", "tabs", "tab", "tabpanels", "tabpanel",
  "listbox", "listitem", "richlistbox", "richlistitem",
  "tree", "treecols", "treecol", "treechildren",
  // menus and popups
  "menupopup", "panel", "tooltip", "menu", "menuitem", "menuseparator", "menulist",
  // controls (both namespaces)
  "button", "checkbox", "radio", "radiogroup", "input", "textarea", "select", "option",
  // HTML, under an HTML host
  "div", "span", "p", "a", "img", "ul", "ol", "li", "dl", "dt", "dd",
  "h1", "h2", "h3", "h4", "h5", "h6", "hr", "br", "pre", "code", "kbd",
  "small", "strong", "em", "b", "i", "u", "s", "sub", "sup",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td",
  "form", "fieldset", "legend", "details", "summary", "figure", "figcaption",
  "header", "footer", "main", "nav", "section", "article", "aside",
  "progress", "meter", "canvas", "svg", "path", "circle", "rect", "line", "g", "text",
]);

/** The XUL tag for a window that loads a web page. Only with `web_frame`. */
const WEB_FRAME = "browser";

/**
 * What makes a <browser> a *content* window rather than a chrome one, and what
 * hands its tooltips and context menu to the browser around it. Set here, not
 * by the drop: nine attributes are nine chances to forget one, and forgetting
 * this particular one is not the kind of mistake a person should be able to
 * make by writing a view. The drop says where it goes and what to load; the
 * shell says what kind of window it is.
 */
const WEB_FRAME_ATTRS: Record<string, string> = {
  type: "content",
  remote: "true",
  maychangeremoteness: "true",
  messagemanagergroup: "browsers",
  disableglobalhistory: "true",
  tooltip: "aHTMLTooltip",
  autocompletepopup: "PopupAutoComplete",
  contextmenu: "contentAreaContextMenu",
};

export function toPreact(
  node: VNode | string,
  dispatch: (a: Action) => void,
  policy: ViewPolicy = {},
): ComponentChild {
  if (typeof node === "string") return node;
  const tag = allow(node.tag, policy);
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
  if (tag === WEB_FRAME) dress(props);
  return h(
    tag === "fragment" ? Fragment : tag,
    props,
    node.kids.map((kid) => toPreact(kid, dispatch, policy)),
  );
}

function allow(tag: string, policy: ViewPolicy): string {
  if (tag === "fragment" || ELEMENTS.has(tag)) return tag;
  if (tag === WEB_FRAME) {
    if (policy.webFrame) return tag;
    throw new Error(
      `view: <${WEB_FRAME}> は drop.toml の [actor] に web_frame = true と書いた drop だけ` +
        "(入れる人の画面に「ページを読み込む窓を置く」と出る)",
    );
  }
  throw new Error(
    `view: 知らない要素 <${tag}>。殻が描けるのは決まった顔ぶれだけ` +
      "(_shared/vnode.ts の ELEMENTS)。要るなら registry に PR を、" +
      "それが要素ひとつで済む話でないなら actor.ts を書く道がある",
  );
}

/** The kind-of-window attributes win over anything the view said. */
function dress(props: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(WEB_FRAME_ATTRS)) props[key] = value;
  const src = props.src === undefined ? "" : String(props.src);
  // the same rule OpenURL keeps: a drop is handed the web, not the browser's
  // own pages or the disk. An empty src leaves the window blank.
  if (!/^https?:\/\//.test(src)) delete props.src;
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
