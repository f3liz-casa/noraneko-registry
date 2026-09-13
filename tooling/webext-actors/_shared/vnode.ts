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
import { isStyleData, printStyle, type Sheet, type StyleData } from "./style.ts";
// 殻が drop に許していることの、ただ一つの表。repo では ../abi.json が
// abi/v1.json への symlink、build のときは build.rb が同じ名前で写すので、
// 書く場所は一つのまま、どちらからでも同じものを読む。
import abi from "../abi.json" with { type: "json" };

const TAGS: ReadonlySet<string> = new Set(abi.tags);
const WEB_FRAME_TAG: string = abi.web_frame_tag;
const PROPS: ReadonlySet<string> = new Set(abi.props.any);
const PROP_PREFIXES: readonly string[] = abi.props.prefixes;
const URL_PROPS: ReadonlySet<string> = new Set(abi.props.url_valued);
const URL_SCHEMES: readonly string[] = abi.props.url_schemes;
// Firefox 自身のアイコン(chrome://global/skin/)。任意の chrome: ではなく、ここだけ
const URL_PREFIXES: readonly string[] = abi.props.url_prefixes;
// <key> -- 押されたことを聞ける、ただ一つの「描かない要素」。宣言した組み合わせ
// だけで、綴り直すのは殻(abi/v1.json の key_combo)。
const KEY_TAG: string = abi.key_tag;
const KEY_MODIFIERS: Record<string, string> = abi.key_combo.modifiers;
const KEY_NAMED: Record<string, string> = abi.key_combo.named;

export interface VNode {
  tag: string;
  props: Record<string, unknown>;
  kids: (VNode | string)[];
}
export interface Action {
  __type: string;
  [field: string]: unknown;
}

/**
 * What this drop declared in drop.toml's `[permissions]`. The shell holds it and
 * turns down anything not in it -- so "これ以外のことはできません" on the install
 * screen is a sentence about this object, not a hope. abi/v1.json is the table
 * both this and that screen are written from.
 */
export interface ViewPolicy {
  /** `web_frame = true`: the view may say `browser` (a window that loads a web page) */
  webFrame?: boolean;
  /** `chrome_style = true`: `setup().style` (one raw sheet, which reaches anything) */
  chromeStyle?: boolean;
  /** `open_url = true`: OpenURL */
  openUrl?: boolean;
  /** `current_url = true`: Ask("url") */
  currentUrl?: boolean;
  /** `prefs = [...]`: the prefs it may read and write, by name */
  prefs?: string[];
  /** `keys = [...]`: the key combinations it may take, written as they are pressed ("Accel+Alt+Z") */
  keys?: string[];
  /** `commands = [...]`: the browser's own commands it may run, by name (abi の commands) */
  commands?: string[];
  /** its own corner of about:config (noraneko.<name>.), free without listing */
  ownPrefix?: string;
  /**
   * この drop の正体(drop.toml の uuid)。宣言ではないけれど、殻がこれを持って
   * いないと、設定の頁でこの drop 自身の一枚を見つけられない。
   */
  uuid?: string;
  /**
   * 鍵 → 字。**選び終わったもの**(どのロケールにするかは tsubakiActor が決める)。
   * logic は `t(:add)` と鍵で書き、どの字になるかを知らない -- style と同じ筋で、
   * データを渡して、印字するのは殻。
   */
  text?: Record<string, string>;
}

/** What only this side can know about the event that raised an action. */
export interface EventFacts {
  screenX?: number;
  screenY?: number;
  value?: string;
  checked?: boolean;
  key?: string;
  /** the page's own title, when the thing that raised this is a web frame */
  title?: string;
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
const ELEMENTS = TAGS;

/** The XUL tag for a window that loads a web page. Only with `web_frame`. */
const WEB_FRAME = WEB_FRAME_TAG;

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
  sheet?: Sheet,
): ComponentChild {
  if (typeof node === "string") return node;
  if (isText(node)) return say(node, policy);
  const tag = allow(node.tag, policy);
  // <key> は押しかたを combo の一つの字で持っていて、keycode / key / modifiers に
  // 綴り直すのは殻。宣言に無い組み合わせは **その <key> だけ** 置かない -- 一枚が
  // 丸ごと消えると、直す人には何が起きたのか見えないので。
  const keyAttrs = tag === KEY_TAG ? bindKey(String(node.props.combo ?? ""), policy) : undefined;
  if (tag === KEY_TAG && !keyAttrs) return null;
  const props: Record<string, unknown> = {};
  let styleClass: string | undefined;
  for (const key of Object.keys(node.props)) {
    const value = node.props[key];
    if (value === null || value === undefined) continue;
    if (keyAttrs && key === "combo") continue; // 殻が綴り直したので、もう用は済んでいる
    if (key.startsWith("on:")) {
      // a copy this side owns: what comes out of the worker is only read through
      const action = { ...(value as Action) };
      const type = key.slice(3);
      props[`on${type}`] = (ev: Event) => {
        // a view that says what a right-click means, means it: the browser's own
        // menu opening on top of the drop's would be nobody's intention
        if (type === "contextmenu") ev.preventDefault();
        dispatch({ ...action, __event: factsOf(ev) });
      };
    } else if (key === "style" && isStyleData(value)) {
      // style はデータで来る。CSS の字にするのは style.ts だけで、そこが
      // 印字できないものは、ここにも出てこない(url( も `;` も書きようがない)。
      // 入れ子があれば class 一つと規則一枚、無ければ style 属性。
      const printed = printStyle(value as StyleData, sheet);
      if (printed.style) props.style = printed.style;
      styleClass = printed.class;
    } else if (isText(value)) {
      if (allowProp(tag, key, "")) props[key] = say(value, policy);
    } else if (allowProp(tag, key, value)) {
      props[key] = value;
    }
  }
  // view が class も書いていたら、両方を着せる
  if (styleClass) props.class = [props.class, styleClass].filter(Boolean).join(" ");
  if (keyAttrs) {
    const { key: char, ...rest } = keyAttrs;
    Object.assign(props, rest);
    // `key` だけは props で渡せない -- preact がそれを「並べ替えの目印」として
    // 自分のものにしていて、属性には降りていかない(diffProps が名指しで飛ばす)。
    // XUL の <key key="Z"> では、そこが押す字そのものなので、要素ができたところで書く。
    if (char) props.ref = (el: Element | null) => el?.setAttribute("key", char);
  }
  if (tag === WEB_FRAME) dress(props);
  return h(
    tag === "fragment" ? Fragment : tag,
    props,
    node.kids.map((kid) => toPreact(kid, dispatch, policy, sheet)),
  );
}

function allow(tag: string, policy: ViewPolicy): string {
  if (tag === "fragment" || ELEMENTS.has(tag)) return tag;
  if (tag === KEY_TAG) {
    if (policy.keys?.length) return tag;
    throw new Error(
      `view: <${KEY_TAG}> は drop.toml の [permissions] に keys = [...] と書いた drop だけ` +
        "(入れる人の画面に「キーボードの … を受け取ります」と出る)",
    );
  }
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

/**
 * 書いてよい属性(abi/v1.json の props)。要素は inert でも、属性は inert ではない --
 * `dangerouslySetInnerHTML` は木を丸ごと差し込むし、`src` は電話をかける。だから
 * 表に無い名前は落として、console に一行。`style` はデータ(style.ts)、`on:*` は
 * 行事で、どちらもここまで来ない。
 */
/** `t(:add)` が越えてきた形。並べていない鍵は、鍵そのものを出す(黙って消さない) */
function isText(v: unknown): v is { __type: "T"; key: string } {
  return typeof v === "object" && v !== null && (v as { __type?: string }).__type === "T";
}
function say(v: { key: string }, policy: ViewPolicy): string {
  const text = policy.text?.[v.key];
  if (text === undefined) console.warn(`[view] 字が並んでいない鍵: ${v.key}(strings.toml)`);
  return text ?? v.key;
}

export function allowProp(tag: string, key: string, value: unknown): boolean {
  if (!PROPS.has(key) && !PROP_PREFIXES.some((p) => key.startsWith(p))) {
    console.warn(`[view] <${tag}> の ${key} は書けない(abi/v1.json の props)`);
    return false;
  }
  if (URL_PROPS.has(key)) {
    const url = String(value);
    const ok = URL_SCHEMES.some((scheme) => url.startsWith(scheme)) ||
      URL_PREFIXES.some((prefix) => url.startsWith(prefix));
    if (!ok) {
      console.warn(
        `[view] <${tag}> の ${key}: ${[...URL_SCHEMES, ...URL_PREFIXES].join(" / ")} で始まる URL だけ`,
      );
      return false;
    }
  }
  return true;
}

/**
 * 一つの <key> の、押しかた。
 *
 * view が書くのは `combo => "Accel+Alt+Z"` の一つの字で、XUL が待っている三つ
 * (`key` / `keycode` / `modifiers`)に綴り直すのはここ。同じ字が drop.toml の
 * 宣言にも並んでいるので、**入れる人が読んだ行と、実際に押せる鍵が同じもの**に
 * なる -- 三つに散らばっていたら、その約束は目で確かめられない。
 *
 * Accel は、どこでも同じ指(Windows と Linux は Ctrl、macOS は Cmd)。
 *
 * 置かないときは null。宣言に無い / 読めない、どちらも **その <key> 一つだけ**で、
 * 他の鍵と view の残りはそのまま。
 */
function bindKey(combo: string, policy: ViewPolicy): Record<string, string> | null {
  if (combo === "") {
    console.warn(`[view] <${KEY_TAG}> に combo が無い("Accel+Alt+Z" のように書く)`);
    return null;
  }
  const declared = (policy.keys ?? []).map(sameKey);
  if (!declared.includes(sameKey(combo))) {
    console.warn(
      `[view] ${combo} は宣言に無いので、この <${KEY_TAG}> だけ置かない` +
        "(drop.toml の [permissions] に keys = [...])",
    );
    return null;
  }
  const spelled = spellKey(combo);
  if (!spelled) console.warn(`[view] <${KEY_TAG}> の combo が読めない: ${combo}`);
  return spelled;
}

/** 同じ押しかたなら同じ字に。指の並び順と、大文字小文字は、押しかたを変えない */
function sameKey(combo: string): string {
  const parts = combo.split("+").map((p) => p.trim().toLowerCase()).filter(Boolean);
  const last = parts.pop() ?? "";
  return [...parts.sort(), last].join("+");
}

/** "Accel+Alt+Z" -> { modifiers: "accel alt", key: "Z" } */
function spellKey(combo: string): Record<string, string> | null {
  const parts = combo.split("+").map((p) => p.trim()).filter(Boolean);
  const last = parts.pop() ?? "";
  const modifiers: string[] = [];
  for (const part of parts) {
    const m = KEY_MODIFIERS[part.toLowerCase()];
    if (!m) return null;
    if (!modifiers.includes(m)) modifiers.push(m);
  }
  const out: Record<string, string> = {};
  const named = KEY_NAMED[last.toLowerCase()];
  if (named) out.keycode = named;
  else if (/^[A-Za-z0-9]$/.test(last)) out.key = last.toUpperCase();
  else return null;
  if (modifiers.length) out.modifiers = modifiers.join(" ");
  return out;
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
  const frame = ev.target as { contentTitle?: unknown } | null;
  if (frame && typeof frame.contentTitle === "string") facts.title = frame.contentTitle;
  return facts;
}
