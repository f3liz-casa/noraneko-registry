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
// The view's own vocabulary -- which TAGS it may name -- is held in vnode.ts.
// It is a list, not a filter on the way out: what a reviewer reads is the
// drop's data plus a shell whose whole reach is written down. `<browser>` (a
// window that loads a web page) is not in it unless the drop declared
// `web_frame` in drop.toml, and even then the shell, not the drop, decides what
// kind of window it is. `<key>` is the same shape of promise from the other
// side: it draws nothing, it only listens, and a drop gets one for each key
// combination it wrote down in drop.toml -- an undeclared one is left out
// alone, and the rest of the view goes up as it is.
//
// Everything placed goes through ctx.io / mount, so removing the drop takes the
// views, the style and the pref observers back out by itself. What mount places
// also moves atomically (std-preact-xul), so a redraw that reorders the view
// does not quietly reload the page inside a <browser>.

import { h, mount, signal, useSignalValue, type ReadonlySignal } from "std";
import type { ContentCtx } from "./defineActor.ts";
import { toPreact, type Action, type VNode, type ViewPolicy } from "./vnode.ts";
import { makeSheet, type Sheet } from "./style.ts";
import abi from "../abi.json" with { type: "json" };
import { COMMANDS } from "./commands.ts";

/** 設定の頁(about:nora:settings)。ここだけが `at: "settings"` の置き場所 */
const SETTINGS_PAGE: string = abi.settings_page;

interface Anchor {
  /** the name `view` answers with when there are several. The only one may leave it out ("main"). */
  name?: string;
  /**
   * where, relative to what the selector found: after / before / inside it.
   *
   * `"keyset"` is the one place that is not a selector: the window's own keyset,
   * where a <key> has to be a direct child for Firefox to look at it at all.
   * The shell stands this drop's own <keyset> next to #mainKeyset, so the keys
   * go away with the drop and nothing of the browser's is edited.
   *
   * `"settings"` is the other one: the drop's own page in about:nora:settings.
   * A drop that asks for it says so twice -- here, and by matching the settings
   * page as well as the window in drop.toml -- and then the same logic is
   * answering in two documents at once. They do not share memory; they share
   * prefs, which is how two windows already agree with each other.
   *
   * `"toolbar"` is a place people can move. The shell makes one CustomizableUI
   * widget for the drop and hands each window the instance that belongs to it,
   * so where someone drags it in customize mode is remembered by the browser --
   * not by the drop, which never learns where it ended up.
   *
   * `"menu"` は、**本体の** menupopup の中。`menu` でどれかを名指しして
   * (abi の menus)、行はその popup の末尾に足される。本体の行は動かさない。
   * その menu が「何についての menu か」を abi が知っているので、右クリック
   * されたタブの目印が host に写る -- drop はその目印で CSS を書けて、popup が
   * 塗られる前に worker を往復しなくていい。
   */
  at?: "after" | "before" | "parent" | "keyset" | "settings" | "toolbar" | "menu";
  /** `at: "toolbar"` only: which CustomizableUI area to start in (abi の toolbar_areas) */
  area?: string;
  /** `at: "menu"` only: which of the browser's menupopups (abi の menus) */
  menu?: string;
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
  /**
   * The same, for a pref whose string holds JSON: it is read as the value it
   * spells, and SetPref on one of these writes the value back as JSON. A list
   * that has to keep someone else's shape (a setting another add-on already
   * writes) is the reason this exists; a setting of one's own is one pref.
   */
  prefs_json?: string[];
  /**
   * 見ていてほしい出来事。いまタブだけ(abi の tab_events)。一つでも並べたら
   * drop.toml に `tabs = "read"` が要る -- 出来事にはタブそのものが乗ってくるので。
   */
  watch?: { tabs?: string[] };
  /**
   * 読み戻す覚書の鍵。SessionStore の per-tab value は鍵で一つずつ訊くものなので、
   * 「どの鍵を持っている drop か」を先に言ってもらう。鍵を長くする
   * (`nora.<uuid>.<鍵>`)のは殻で、`tab_values` の宣言が要る。
   */
  tab_values?: string[];
  /**
   * 同じことを、窓に。置き場所が per-window value になるだけで、作法は同じ
   * (鍵を長くするのは殻、`window_values` の宣言が要る)。start(facts) の
   * `window` に、並べた鍵のぶんが入って届く。
   */
  window_values?: string[];
  /**
   * 前回から戻ってくるタブを、どう迎えるか。**logic には訊かない**ので、
   * ここがデータで要る(下の bakeOnRestore に、なぜかが書いてある)。
   */
  restore?: Restore;
}
/**
 * 戻ってくるタブに、覚書から焼くもの。
 *
 * `marks`: その鍵の覚書を持っているタブに、同じ名前の目印を同じ値で。
 * `hide_unless`: その鍵の覚書が **窓の覚書**と違うタブは、仕舞ったまま戻す
 * (束で仕舞う drop の、いちばん大事な一行。`tabs = "write"` が要る)。
 */
interface Restore {
  marks?: string[];
  hide_unless?: string;
}
interface Frame {
  /** one VNode (it goes to the first anchor), or the anchor's name => its VNode */
  view: VNode | Record<string, VNode | null> | null;
  effects?: Action[];
}

export async function runTsubakiActor(
  ctx: ContentCtx,
  policy: ViewPolicy = {},
): Promise<void> {
  const ops = ctx.ops;
  if (!ops) throw new Error("a Tsubaki actor needs std's runtime (ctx.ops)");

  // --- したことを残す ------------------------------------------------------
  //
  // effect を carry out するたび、一行残す。捕まえるためではなく、あとで辿れる
  // ように -- 信頼して入れる、というのは見ないことにするのではなくて、あとで
  // 見られるから安心して入れられる、ということだと思う。
  //
  // observer notification で出すので、drop は drop のままでいられる(記録のために
  // 本体の何かを import しない)し、誰も聞いていなくても何も壊れない。
  const note = (did: string, about: string, extra?: Record<string, unknown>): void => {
    try {
      Services.obs.notifyObservers(
        null,
        "nora-drop-did",
        JSON.stringify({ drop: policy.name ?? "?", uuid: policy.uuid ?? "?", at: Date.now(), did, about, ...extra }),
      );
    } catch {
      // 記録が取れないことで、drop が止まらないように
    }
  };
  const brief = (v: unknown): string => {
    const t = typeof v === "string" ? v : JSON.stringify(v) ?? String(v);
    return t.length > 60 ? t.slice(0, 60) + "…" : t;
  };

  // 宣言していないことは、殻が断る。断ったときは黙らない -- 入れる人の画面に
  // 出ている行と、実際にできることが違ったら、それはどちらかが嘘なので。
  //
  // 断りかたは「だめ」ではなく「こう書けば通る」。drop.toml にそのまま貼れる行を
  // 出す(同じことは一度だけ)。書いている最中に、宣言を探しに行かなくていいように。
  const told = new Set<string>();
  const refuse = (what: string, permission: string, line?: string): void => {
    note("outside", what, { permission });
    if (told.has(permission + ":" + what)) return;
    told.add(permission + ":" + what);
    console.warn(
      `[${policy.name ?? "tsubaki-actor"}] ${what} は、まだ宣言していません\n` +
        `  drop.toml に足すなら:\n\n    [permissions]\n    ` +
        (line ?? (permission.includes("=") ? permission : `${permission} = true`)) + `\n`,
    );
  };
  // 字を選ぶ。drop は鍵で書き(std の `t(:add)`)、どのロケールのどの字になるかは
  // ここで決まる。ブラウザの言語 → その言語 → en の順に見て、最初に有ったもの。
  // 無い鍵は鍵そのものが出る(黙って消えるより、出ているほうが直せる)。
  const strings = (policy as { strings?: Record<string, Record<string, string>> }).strings ?? {};
  const wanted = Services.locale.appLocaleAsBCP47 ?? "en";
  const table = strings[wanted] ?? strings[wanted.split("-")[0]] ?? strings.en ?? {};
  const viewPolicy: ViewPolicy = { ...policy, text: { ...(strings.en ?? {}), ...table } };

  // 自分の名前空間(noraneko.<drop の名前>.)は名指しが要らない。それ以外は名指しだけ。
  const named = new Set(policy.prefs ?? []);
  const mayTouchPref = (name: string): boolean => {
    if (policy.ownPrefix && name.startsWith(policy.ownPrefix)) return true;
    if (named.has(name)) return true;
    refuse(
      `pref "${name}"`,
      "prefs",
      `prefs = ${JSON.stringify([...named, name].filter((n, i, all) => all.indexOf(n) === i))}`,
    );
    return false;
  };

  // A browser window: wait until it is a whole one (gBrowser and the rest), and
  // leave the ones that are not really windows alone -- a popup opened with
  // window.open has no toolbar to put anything next to. Neither is true of an
  // ordinary page, where both of these are simply absent.
  const win = window as unknown as { delayedStartupPromise?: Promise<void> };
  if ((document.documentElement.getAttribute("chromehidden") ?? "").includes("toolbar")) return;
  if (win.delayedStartupPromise) await win.delayedStartupPromise;

  const setup = ((await ops.call("setup")) ?? {}) as Setup;
  const anchors = setup.anchors ?? [setup.anchor ?? {}];
  // 同じ logic が、窓と設定の頁の両方に居ることがある。置き場所のほうは
  // 行き先が決まっているので、ここで分ける -- 窓の #browser は設定の頁に無いし、
  // 設定の一枚は窓に出しても意味が無い。view は、どちらでも同じ名前で答える。
  const onSettings = String(document.location?.href ?? "").startsWith(SETTINGS_PAGE);
  const belongsHere = (a: Anchor) => (a.at === "settings") === onSettings;
  // already here: this window was done once (an actor can be asked twice)
  for (const a of anchors) if (a.id && document.getElementById(a.id)) return;
  const names = anchors.map((a, i) => {
    if (a.name) return a.name;
    if (anchors.length === 1) return "main";
    throw new Error(`setup: anchors[${i}] に "name" が無い(view はその名前で答える)`);
  });
  const asJson = new Set((setup.prefs_json ?? []).filter(mayTouchPref));
  const watched = [...(setup.prefs ?? []).filter(mayTouchPref), ...asJson];
  const readOne = (name: string) => (asJson.has(name) ? readJsonPref(name) : readPref(name));
  const readAll = () => {
    const out: Record<string, unknown> = {};
    for (const name of watched) out[name] = readOne(name);
    return out;
  };

  // one signal, one entry per anchor: a frame is one view of the whole drop,
  // even when it is drawn in two places
  const views = signal<Record<string, VNode | null>>({});
  const hosts: Element[] = [];

  // style がデータで来たときの置き場所。**CSS の字を書くのは style.ts だけ**で、
  // ここは置き場所を持っているだけ。一枚も要らなければ <style> も作らない。
  // 作ったものは ctx.io.style の台帳に載るので、drop を外すと一緒に消える。
  let sheetEl: HTMLStyleElement | null = null;
  const sheet: Sheet = makeSheet((css) => {
    if (!sheetEl) sheetEl = ctx.io.style(document, "");
    sheetEl.textContent += `${css}\n`;
  });

  // --- タブ ---------------------------------------------------------------------
  // タブは、この drop が置いたものではない。だから殻が渡すのは「読んだこと」と、
  // **自分が付けた**目印と覚書の付け外しだけ。タブそのものは渡さない。
  //
  // `id` は、この窓のために鋳った不透明な字。`linkedPanel` は使わない -- あれは
  // 起動のたびに作り直されるので、覚えた名前が別のタブに落ちる(rename-tab が
  // 一度それで失敗している)。WeakMap なので、タブが閉じれば id も一緒に消える。
  const MARK = `data-nora-${policy.uuid ?? ""}-`;
  // 目印は、二つの顔で置く。**選ぶための属性**と、**字を出すための変数**。
  // `attr()` は、その擬似要素が乗っている要素の属性しか読めないので、タブに付けた
  // 目印を `.tab-label::before` から出すには、継ぐほう(custom property)が要る
  // ── 実機で一度、名前が空で出た。値は CSS の文字列として置く(引用符は殻が付ける)。
  const MARK_VAR = `--nora-${policy.uuid ?? ""}-`;
  const VALUE = `nora.${policy.uuid ?? ""}.`;
  const NAME_OK = /^[a-z0-9][a-z0-9-]*$/;
  const XHTML = "http://www.w3.org/1999/xhtml";

  const tabIds = new WeakMap<Element, string>();
  let minted = 0;
  const idOf = (tab: Element): string => {
    const found = tabIds.get(tab);
    if (found) return found;
    const id = `tab${++minted}`;
    tabIds.set(tab, id);
    return id;
  };
  const browser = () =>
    (window as unknown as {
      gBrowser?: { tabs?: ArrayLike<Element>; selectedTab?: Element; tabContainer?: EventTarget };
    }).gBrowser ?? null;
  const allTabs = (): Element[] => {
    const tabs = browser()?.tabs;
    return tabs ? Array.from(tabs) : [];
  };
  /** その id のタブ。閉じたタブの id は、もうどのタブでもない(null が返る) */
  const tabOf = (id: string): Element | null => allTabs().find((t) => tabIds.get(t) === id) ?? null;

  // 覚書は鍵で一つずつ訊くものなので、setup が「どの鍵を持っているか」を言う。
  // 宣言が無ければ、鍵は無いのと同じ(読むほうも書くほうも通らない)。
  const wantedValues = setup.tab_values ?? [];
  if (wantedValues.length && !policy.tabValues) refuse("タブの覚書を読む", "tab_values");
  const valueKeys = policy.tabValues ? wantedValues.filter((k) => NAME_OK.test(k)) : [];

  /**
   * 復元で戻ってくるタブの覚書を、包みのところで預かる棚。
   *
   * SessionStore がその覚書をタブに結びつけるより **先に** 包みのほうが見ている
   * (包みは戻すタブの data をそのまま持っている)ので、その間に一覧を作ると
   * 「覚書を持っていないタブ」に見える ── 引き受けてくれる drop は、それを
   * 自分の束に入れてしまう(実機で一度、そうやって別の束のタブを奪った)。
   */
  const kept = new WeakMap<Element, Record<string, string>>();

  let store: { getCustomTabValue(t: Element, k: string): string } | null = null;
  const sessionStore = () =>
    (store ??= ChromeUtils.importESModule(
      "resource:///modules/sessionstore/SessionStore.sys.mjs",
    ).SessionStore);

  /**
   * 一枚のタブが、logic にどう見えるか(abi の tab)。
   *
   * `url` は current_url も宣言した drop にだけ入る -- `Ask("url")` と同じ線で、
   * 「タブのことを読む」と「どこを見ているかを読む」は別の一文だから。
   * `values` は、その drop 自身の覚書だけ。
   */
  const tabFact = (tab: Element, index = allTabs().indexOf(tab)): Record<string, unknown> => {
    const t = tab as Element & {
      pinned?: boolean;
      linkedBrowser?: { currentURI?: { spec?: string } };
      group?: { id?: string } | null;
    };
    const values: Record<string, unknown> = {};
    for (const key of valueKeys) {
      const raw = (() => {
        try {
          const live = sessionStore().getCustomTabValue(tab, VALUE + key);
          if (live !== "") return live;
        } catch {
          // SessionStore がまだそのタブを知らないことがある(復元の最中)
        }
        return kept.get(tab)?.[VALUE + key] ?? "";
      })();
      if (raw !== "") values[key] = raw;
    }
    return {
      id: idOf(tab),
      index,
      title: tab.getAttribute("label") ?? "",
      url: policy.currentUrl ? (t.linkedBrowser?.currentURI?.spec ?? "") : "",
      pinned: t.pinned === true,
      selected: tab === browser()?.selectedTab,
      // 仕舞われているタブ。この drop が仕舞ったものも、ほかの誰かが仕舞った
      // ものも、同じ一つとして見える(タブ帯に出ていない、という事実だから)
      hidden: (tab as { hidden?: boolean }).hidden === true,
      muted: tab.hasAttribute("muted"),
      // まだ中身を持っていないタブ(前回から戻ってきて、まだ開かれていない)。
      // Firefox がそれに着せている属性を、そのまま読んでいる
      discarded: tab.hasAttribute("pending"),
      group: t.group?.id ?? "",
      container: tab.getAttribute("usercontextid") ?? "",
      values,
    };
  };
  const tabsFact = (): Record<string, unknown>[] => {
    if (!policy.tabs) {
      refuse("タブのことを読む", 'tabs = "read"');
      return [];
    }
    return allTabs().map((tab, i) => tabFact(tab, i));
  };
  const selectedFact = (): Record<string, unknown> | null => {
    if (!policy.tabs) {
      refuse("タブのことを読む", 'tabs = "read"');
      return null;
    }
    const tab = browser()?.selectedTab;
    return tab ? tabFact(tab) : null;
  };

  /**
   * タブを選ぶ・仕舞う・また見せる。`tabs` の上の段。
   *
   * 読むだけの drop と、並びに手を入れる drop は、入れる人にとって別のことなので、
   * 段で分けてある(画面に出る一文も別)。段が足りなければ、しない。
   */
  const mayWriteTabs = (what: string): boolean => {
    if (policy.tabs === "write") return true;
    refuse(what, 'tabs = "write"');
    return false;
  };

  /**
   * タブを仕舞う / また見せる。選ばれているタブを仕舞わないのは、本体の判断。
   *
   * 仕舞ったタブは覚えておく。**drop を外すときに、見せて返す**ため ── タブ帯から
   * 消えたタブを戻す道が、外した人の手元に無くなってしまうので。
   */
  const folded = new WeakSet<Element>();
  const foldTab = (tab: Element, away: boolean): void => {
    const gb = browser() as unknown as
      | { hideTab?: (t: Element) => void; showTab?: (t: Element) => void }
      | null;
    const fn = away ? gb?.hideTab : gb?.showTab;
    if (!gb || !fn) {
      console.warn("[tsubaki-actor] この窓では、タブを仕舞えない");
      return;
    }
    try {
      fn.call(gb, tab);
      if (away) folded.add(tab);
      else folded.delete(tab);
    } catch (e) {
      console.warn("[tsubaki-actor] タブを仕舞う / 見せるところで転んだ:", e);
    }
  };
  if (policy.tabs === "write") {
    // 窓が閉じるときは、返さない。そのときの仕舞われかたは、その窓の姿として
    // SessionStore が持っていくものなので、ここで見せてしまうと「閉じた窓を戻す」が
    // ぜんぶ見える状態で戻ってくる。外されたのか、窓が閉じたのかを、先に知っておく
    let closing = false;
    ctx.io.listen(window, "unload", () => {
      closing = true;
    });
    ctx.io.defer(() => {
      if (closing) return;
      for (const tab of allTabs()) if (folded.has(tab)) foldTab(tab, false);
    });
  }

  /** 目印 / 覚書の、短い名前を、本当の名前に。読めない名前は付けない */
  const longName = (short: unknown, prefix: string): string | null => {
    const name = String(short ?? "");
    if (NAME_OK.test(name)) return prefix + name;
    console.warn("[tsubaki-actor] 目印 / 覚書の名前は a-z0-9- で:", name);
    return null;
  };

  /**
   * タブに、この drop の目印を一つ。**二つの顔**で置く -- 選ぶための属性と、
   * 字を出すための変数。ここが一か所なのは、戻ってくるタブに焼くほう
   * (bakeOnRestore)も、同じ手で置く必要があるから。
   */
  const markTab = (tab: Element, short: unknown, value: string): void => {
    const name = longName(short, MARK);
    if (!name) return;
    tab.setAttribute(name, value);
    // CSS の文字列として置く(`content: var(--…)` にそのまま渡せるように)
    (tab as HTMLElement).style.setProperty(MARK_VAR + String(short), JSON.stringify(value));
  };

  // --- 窓の覚書 -----------------------------------------------------------------
  // タブのものと同じ作法で、置き場所が窓なだけ。タブ一枚に属さないこと
  // (その窓で、どの束を開いていたか)は、ここに置く。
  const wantedWindow = setup.window_values ?? [];
  if (wantedWindow.length && !policy.windowValues) refuse("窓の覚書を読む", "window_values");
  const windowKeys = policy.windowValues ? wantedWindow.filter((k) => NAME_OK.test(k)) : [];
  const windowValue = (key: string): string => {
    try {
      return (sessionStore() as unknown as { getCustomWindowValue(w: Window, k: string): string })
        .getCustomWindowValue(window, VALUE + key);
    } catch {
      return "";
    }
  };
  /** start(facts) の `window`。書いていない鍵は、入らない */
  const windowFacts = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const key of windowKeys) {
      const raw = windowValue(key);
      if (raw !== "") out[key] = raw;
    }
    return out;
  };

  /**
   * 名札のところに出す、字を打つ欄。
   *
   * 一度の編集のために生まれて、Enter / 外を押す で閉じる。**要素は殻のもの**
   * (`.nora-prompt`)で、焦点も caret もここが持つ -- view で描けるものではないし、
   * 描けたとしても、タブ自身の並びの中に置くのは drop の仕事ではない。
   *
   * Escape のときは、何も dispatch しない。打っていた字はどこにも残らないので、
   * logic のほうに「やめた」を届けても、することが無い。
   */
  let promptSheet = false;
  const promptOn = (effect: Action): void => {
    const tab = tabOf(String(effect.tab ?? ""));
    if (!tab) return;
    const label = tab.querySelector(".tab-label") as HTMLElement | null;
    const container = tab.querySelector(".tab-label-container");
    if (!label || !container) {
      console.warn("[tsubaki-actor] Prompt: そのタブに名札が無い");
      return;
    }
    if (!promptSheet) {
      promptSheet = true;
      // 欄は殻のものなので、見た目も殻が持つ。drop の一枚が要らない
      ctx.io.style(
        document,
        ".nora-prompt { margin: 0; min-width: 0; flex: 1; font: inherit; outline: none;" +
          " padding: 2px 4px; border-radius: 4px;" +
          " background: var(--toolbar-field-background-color, Field);" +
          " color: var(--toolbar-field-color, FieldText);" +
          " border: 1px solid var(--toolbar-field-border-color, ButtonBorder); }",
      );
    }
    const input = document.createElementNS(XHTML, "input") as HTMLInputElement;
    input.type = "text";
    input.className = "nora-prompt";
    input.value = String(effect.value ?? "");
    input.placeholder = String(effect.placeholder ?? "");
    const shown = label.style.display;
    label.style.display = "none";
    ctx.io.place(input, { before: container });
    input.focus();
    input.select();

    let over = false;
    const close = () => {
      if (over) return;
      over = true;
      input.remove();
      label.style.display = shown;
    };
    const save = () => {
      if (over) return;
      const typed = input.value.trim();
      close();
      dispatch({ __type: String(effect.action), tab: String(effect.tab ?? ""), value: typed });
    };
    // 打っている途中で drop が外されることもある。そのときは、打った字は
    // どこにも残さずに、名札だけ戻す
    ctx.io.defer(close);
    ctx.io.listen(input, "blur", save);
    ctx.io.listen(input, "keydown", (ev: KeyboardEvent) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        save();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        close();
      }
    });
  };

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
    note(
      String(effect.__type),
      brief(effect.name ?? effect.url ?? effect.selector ?? effect.command ?? effect.fields ?? effect.text ?? ""),
      effect.value === undefined ? undefined : { value: brief(effect.value) },
    );
    switch (effect.__type) {
      case "SetPref": {
        const name = String(effect.name);
        if (!mayTouchPref(name)) return;
        if (asJson.has(name)) Services.prefs.setStringPref(name, JSON.stringify(effect.value ?? null));
        else writePref(name, effect.value);
        return;
      }
      case "OpenURL": {
        if (!policy.openUrl) return refuse("OpenURL", "open_url");
        const win = window as unknown as { openWebLinkIn?: (url: string, where: string) => void };
        const url = String(effect.url);
        if (!/^https?:\/\//.test(url)) return; // 開くのは web の URL だけ
        if (win.openWebLinkIn) win.openWebLinkIn(url, "tab");
        else window.open(url, "_blank");
        return;
      }
      case "Ask": {
        const action: Action = { __type: String(effect.action) };
        for (const field of asStrings(effect.fields)) {
          // 事実そのものに宣言が要るものがある。断ったときは空を返す
          // -- logic は「訊いたのに来なかった」を扱えばよく、落ちなくていい。
          if (field === "url" && !policy.currentUrl) {
            refuse('Ask("url")', "current_url");
            action[field] = "";
            continue;
          }
          // タブのことは、この窓を見ないと分からない(factOf は窓を持っていない)
          if (field === "tabs") {
            action[field] = tabsFact();
            continue;
          }
          if (field === "tab") {
            action[field] = selectedFact();
            continue;
          }
          action[field] = factOf(field);
        }
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
      case "OpenPopup": {
        const popup = look(hosts, String(effect.selector)) as
          | { openPopupAtScreen?: (x: number, y: number, isContext: boolean) => void }
          | null;
        if (popup?.openPopupAtScreen) popup.openPopupAtScreen(Number(effect.x), Number(effect.y), true);
        else console.warn("[tsubaki-actor] OpenPopup: menupopup が見つからない:", effect.selector);
        return;
      }
      case "ReloadFrame": {
        if (!policy.webFrame) return refuse("ReloadFrame", "web_frame");
        const frame = look(hosts, String(effect.selector)) as { reload?: () => void } | null;
        if (frame?.reload) frame.reload();
        else console.warn("[tsubaki-actor] ReloadFrame: 見つからない:", effect.selector);
        return;
      }
      case "DoCommand": {
        // 二つの門を通る。**宣言に有る**(入れる人の画面に出ている行)ことと、
        // **表に有る**(殻が名前を知っている)こと。どちらか片方でも欠けたら、
        // しない -- 綴り間違いでブラウザの知らない口が開かないように。
        const name = String(effect.name);
        if (!(policy.commands ?? []).includes(name)) return refuse(`DoCommand("${name}")`, "commands");
        const run = COMMANDS[name];
        if (!run) {
          console.warn(`[tsubaki-actor] 表に無い命令: ${name}(abi/v1.json の commands)`);
          return;
        }
        try {
          run(window);
        } catch (e) {
          // 版によっては呼び先が無い。view も、同じ frame の他の effect も止めない
          console.warn(`[tsubaki-actor] 命令が通らなかった: ${name}`, e);
        }
        return;
      }
      case "SetTabAttr":
      case "ClearTabAttr": {
        if (!policy.tabMarks) return refuse(effect.__type, "tab_marks");
        const tab = tabOf(String(effect.tab ?? ""));
        const name = longName(effect.name, MARK);
        if (!tab || !name) return;
        const varName = MARK_VAR + String(effect.name);
        const style = (tab as HTMLElement).style;
        if (effect.__type === "ClearTabAttr") {
          tab.removeAttribute(name);
          style.removeProperty(varName);
        } else {
          markTab(tab, effect.name, String(effect.value ?? ""));
        }
        return;
      }
      case "SetTabValue":
      case "ClearTabValue": {
        if (!policy.tabValues) return refuse(effect.__type, "tab_values");
        const tab = tabOf(String(effect.tab ?? ""));
        const key = longName(effect.key, VALUE);
        if (!tab || !key) return;
        const api = sessionStore() as unknown as {
          setCustomTabValue(t: Element, k: string, v: string): void;
          deleteCustomTabValue(t: Element, k: string): void;
        };
        try {
          if (effect.__type === "ClearTabValue") api.deleteCustomTabValue(tab, key);
          else api.setCustomTabValue(tab, key, String(effect.value ?? ""));
        } catch (e) {
          console.warn("[tsubaki-actor] 覚書が書けなかった:", key, e);
        }
        return;
      }
      case "Prompt": {
        if (!policy.prompt) return refuse("Prompt", "prompt");
        promptOn(effect);
        return;
      }
      case "HideTab":
      case "ShowTab": {
        if (!mayWriteTabs(effect.__type)) return;
        const tab = tabOf(String(effect.tab ?? ""));
        if (tab) foldTab(tab, effect.__type === "HideTab");
        return;
      }
      case "SelectTab": {
        if (!mayWriteTabs("SelectTab")) return;
        const tab = tabOf(String(effect.tab ?? ""));
        const gb = browser() as unknown as { selectedTab?: Element } | null;
        if (tab && gb) gb.selectedTab = tab;
        return;
      }
      case "SetWindowValue":
      case "ClearWindowValue": {
        if (!policy.windowValues) return refuse(effect.__type, "window_values");
        const key = longName(effect.key, VALUE);
        if (!key) return;
        const api = sessionStore() as unknown as {
          setCustomWindowValue(w: Window, k: string, v: string): void;
          deleteCustomWindowValue(w: Window, k: string): void;
        };
        try {
          if (effect.__type === "ClearWindowValue") api.deleteCustomWindowValue(window, key);
          else api.setCustomWindowValue(window, key, String(effect.value ?? ""));
        } catch (e) {
          console.warn("[tsubaki-actor] 窓の覚書が書けなかった:", key, e);
        }
        return;
      }
      case "Log":
        console.log("[tsubaki-actor]", effect.text);
        return;
      default:
        console.warn("[tsubaki-actor] 知らない effect:", effect.__type);
    }
  };

  /**
   * 前回から戻ってくるタブに、覚書のぶんを焼いておく。
   *
   * 戻ってきてから(`restore` の出来事を聞いて)付け直すのでは、**一瞬ぜんぶ
   * 見える**。本体は戻すタブを DocumentFragment に組んで、最後にまとめて挿す
   * ので、その包みの中で焼けば、一度も描かれないまま正しい姿で現れる。
   *
   * 焼くのは二つ。覚書と同じ名前の**目印**(`marks`)と、**仕舞われていたこと**
   * (`hide_unless`: その鍵の覚書が、窓の覚書と違うタブは仕舞ったまま戻す)。
   *
   * **logic には訊かない。** worker の返事は待てないし、待つあいだに塗られて
   * しまう。だから「どう焼くか」は setup() のデータとして先に受け取っておく
   * ── style と同じ筋で、決めるのは logic、するのは殻。
   *
   * ここは本体の形(引数の並び)に寄りかかっている。そこが変わったら焼けなくなる
   * ので、**黙らずに一行残す**。そのときも失うのはタブではなく「最初の一瞬」
   * だけで、あとは logic が start() で整え直す。
   */
  const bakeOnRestore = (restore: Restore): void => {
    const gb = browser() as unknown as Record<string, unknown> | null;
    const original = gb?.createTabsForSessionRestore;
    if (!gb || typeof original !== "function") {
      console.warn("[tsubaki-actor] restore: この窓では、戻ってくるタブに焼けない");
      return;
    }
    // 宣言した鍵だけ。覚書を持っていない drop は、焼くものも持っていない
    const marks = (restore.marks ?? []).filter((k) => valueKeys.includes(k));
    const foldBy = restore.hide_unless ?? "";
    if (foldBy !== "" && !mayWriteTabs("restore の hide_unless")) return;
    if (marks.length === 0 && foldBy === "") return;

    const bake = (out: unknown, args: unknown[]): void => {
      const tabs = Array.isArray(out) ? out : (out as { tabs?: unknown[] } | null)?.tabs;
      if (!Array.isArray(tabs) || tabs.length === 0) return;
      // 覚書は、戻すタブの data のほうに乗っている。**何番目の引数か**には
      // 寄りかからずに、「タブと同じ数だけ並んでいるもの」で見つける
      // (並びは、本体が index で突き合わせている、その同じ並び)
      const list = args.find((a) => Array.isArray(a) && a.length === tabs.length) as
        | unknown[]
        | undefined;
      if (!list) {
        console.warn("[tsubaki-actor] restore: 戻ってくるタブの覚書が見つからない");
        return;
      }
      const here = foldBy === "" ? "" : windowValue(foldBy);
      for (const [i, tab] of tabs.entries()) {
        if (!(tab instanceof Element)) continue;
        const ext = (list[i] as { extData?: Record<string, string> } | undefined)?.extData;
        if (!ext) continue;
        kept.set(tab, ext);
        for (const key of marks) {
          const value = ext[VALUE + key];
          if (value) markTab(tab, key, value);
        }
        if (foldBy === "") continue;
        const mine = ext[VALUE + foldBy] ?? "";
        if (mine !== "" && mine !== here) foldTab(tab, true);
      }
    };

    const wrapped = function (this: unknown, ...args: unknown[]): unknown {
      const out = (original as (...a: unknown[]) => unknown).apply(this, args);
      try {
        bake(out, args);
      } catch (e) {
        console.warn("[tsubaki-actor] restore: 焼けなかった(start で整え直す)", e);
      }
      return out;
    };
    gb.createTabsForSessionRestore = wrapped;
    // 外すときに返す。別の誰かが更にその上から包んでいたら、そのままにしておく
    ctx.io.defer(() => {
      if (gb.createTabsForSessionRestore === wrapped) gb.createTabsForSessionRestore = original;
    });
  };

  // 包むのは start より先。セッションの復元は、この actor が着いたあとに来る
  if (setup.restore) bakeOnRestore(setup.restore);

  take(
    (await ops.call("start", {
      prefs: readAll(),
      url: String(document.location?.href ?? ""),
      // もう本当だったこと。タブを読める drop にだけ、最初の一覧を添える
      ...(policy.tabs ? { tabs: tabsFact() } : {}),
      // 窓の覚書も、もう本当だったこと(前に開いていたときの続き)
      ...(windowKeys.length ? { window: windowFacts() } : {}),
    })) as Frame,
  );

  // 生の CSS の一枚は、どこにでも届く -- 自分が置いたものだけ、ではない。
  // node につくデータの style(style.ts が印字するほう)は自分のものなので、ここには来ない。
  //
  // `{attr}` だけは書き換える(abi の mark_attr)。目印の本当の名前は
  // `data-nora-<uuid>-` で始まるので、そのままでは drop が自分の uuid を綴る
  // ことになる -- 短い名前で書いて、長いほうにするのは殻、を CSS でも通す。
  if (setup.style) {
    if (policy.chromeStyle) {
      ctx.io.style(
        document,
        setup.style.replaceAll(abi.mark_attr.token, MARK).replaceAll(abi.mark_attr.var_token, MARK_VAR),
      );
    }
    else refuse("setup().style", "chrome_style");
  }
  for (const name of watched) {
    ctx.io.pref(name, () => dispatch({ __type: "PrefChanged", name, value: readOne(name) }));
  }

  // 見ていてほしい出来事。並べた名前だけ聞いて、一つの action にして渡す
  // -- 出来事ごとに door を増やさないのは、logic のほうで `kind` の一か所に
  // 書けるようにするため(view は、どの出来事でも同じ一枚を描き直す)。
  const watchTabs = setup.watch?.tabs ?? [];
  if (watchTabs.length && !policy.tabs) refuse("タブの出来事を見る", 'tabs = "read"');
  const strip = browser()?.tabContainer;
  if (policy.tabs && strip) {
    const told = (kind: string, tab: Element | null) =>
      dispatch({
        __type: "TabsChanged",
        kind,
        tab: tab ? tabFact(tab) : null,
        tabs: allTabs().map((t, i) => tabFact(t, i)),
      });
    for (const kind of watchTabs) {
      const spec = (abi.tab_events as Record<string, { event?: string }>)[kind];
      if (!spec?.event) {
        console.warn(`[tsubaki-actor] 知らない出来事: ${kind}(abi/v1.json の tab_events)`);
        continue;
      }
      if (kind !== "dblclick") {
        ctx.io.listen(strip, spec.event, (ev: Event) => told(kind, ev.target as Element));
        continue;
      }
      // 二度押しは、タブの上のどこで起きたかを見てから渡す。閉じるつもりで
      // 押した人のぶんは渡さない -- その手つきの意味は、もう決めた人が居る。
      ctx.io.listen(strip, "dblclick", (ev: MouseEvent) => {
        if (ev.button !== 0 || ev.defaultPrevented) return;
        if (Services.prefs.getBoolPref("browser.tabs.closeTabByDblclick", false)) return;
        const target = ev.target as Element | null;
        if (target?.closest(".tab-close-button")) return;
        const tab = target?.closest(".tabbrowser-tab");
        if (!tab) return;
        ev.preventDefault();
        told(kind, tab);
      });
    }
  }

  // 目印は、この drop がタブに付けたもの。drop を外すときに、全部外す
  // (mount の台帳に載らない -- タブは殻が置いたものではないので)。
  if (policy.tabMarks) {
    ctx.io.defer(() => {
      for (const tab of allTabs()) {
        for (const attr of Array.from(tab.attributes)) {
          if (attr.name.startsWith(MARK)) tab.removeAttribute(attr.name);
        }
        const style = (tab as HTMLElement).style;
        for (const prop of Array.from(style)) {
          if (prop.startsWith(MARK_VAR)) style.removeProperty(prop);
        }
      }
    });
  }

  for (const [i, anchor] of anchors.entries()) {
    if (!belongsHere(anchor)) continue;
    const at = anchor.at === "settings"
      ? await settingsPlace(ctx.io, policy.uuid ?? "", anchor)
      : anchor.at === "toolbar"
      ? toolbarPlace(policy.uuid ?? "", anchor)
      : anchor.at === "menu"
      ? menuPlace(anchor, policy)
      : placeOf(anchor);
    if (!at) continue;
    const host = mount(ctx.io, h(View, { views, name: names[i], dispatch, policy: viewPolicy, sheet }), at);
    hosts.push(host);
    if (anchor.at === "menu") dressMenu(ctx.io, host, anchor, MARK, idOf);
  }
}

function View(props: {
  views: ReadonlySignal<Record<string, VNode | null>>;
  name: string;
  dispatch: (a: Action) => void;
  policy: ViewPolicy;
  sheet: Sheet;
}) {
  const v = useSignalValue(props.views)[props.name];
  return v ? toPreact(v, props.dispatch, props.policy, props.sheet) : null;
}

/** A frame's view as "which anchor gets what". One VNode goes to the first anchor. */
function spread(view: Frame["view"], first: string): Record<string, VNode | null> {
  if (!view) return {};
  if (typeof (view as VNode).tag === "string") return { [first]: view as VNode };
  return { ...(view as Record<string, VNode | null>) };
}

/**
 * ツールバーの、この drop のひとこま。
 *
 * CustomizableUI の widget を一つ作って、その **この窓のぶん**を返す。widget は
 * アプリに一つ、actor は窓ごとなので、どの窓の actor が先に着いても同じことに
 * なるように書いてある: まだ無ければ作り、あれば `forWindow` で自分の窓のものを
 * 訊く(そこが無ければ CustomizableUI が `onBuild` でその場で作る)。
 *
 * **どこに置かれているかを、drop は知らない。** 入れた人が customize mode で
 * 動かした場所をブラウザが覚えていて、drop が言えるのは「最初はここに」だけ。
 * これは減らした機能ではなく、そういう約束 -- 位置は入れた人のもの。
 *
 * 片づけは **ここではしない**。widget はアプリに一つで、この defer は「窓が
 * 閉じた」でも走る。窓を一つ閉じただけで全部の窓からボタンが消えては困るので、
 * `destroyWidget` は drop を外す側(Drops.sys.mts)が、uuid から名前を組んで呼ぶ。
 * 置いた view のほうは mount の台帳で戻る。
 */
function toolbarPlace(uuid: string, anchor: Anchor): Parameters<typeof mount>[2] | null {
  if (uuid === "") {
    console.warn('[tsubaki-actor] at: "toolbar": この drop の uuid が分からない');
    return null;
  }
  const { CustomizableUI } = ChromeUtils.importESModule(
    "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs",
  ) as { CustomizableUI: CustomizableUILike };
  const id = widgetId(uuid);
  const area = Object.hasOwn(abi.toolbar_areas, anchor.area ?? "") ? anchor.area! : "nav-bar";
  if (CustomizableUI.getWidget(id)?.provider !== CustomizableUI.PROVIDER_API) {
    CustomizableUI.createWidget({
      id,
      type: "custom",
      defaultArea: area,
      removable: true,
      onBuild(doc: Document) {
        const item = doc.createXULElement("toolbaritem");
        item.id = id;
        item.setAttribute("removable", "true");
        item.classList.add("chromeclass-toolbar-additional");
        return item;
      },
    });
  }
  const node = CustomizableUI.getWidget(id)?.forWindow(window)?.node ?? null;
  if (!node) {
    console.warn("[tsubaki-actor] toolbar: この窓のこまが作れなかった:", id);
    return null;
  }
  return { parent: node, tag: "hbox", id: anchor.id };
}

/**
 * 本体の menupopup の中の、この drop の行。
 *
 * 足すのは **末尾**(`appendChild`)。本体の menu には並びの決まりがあって
 * (`MenuSectionLayout` は、どの section にも属さない子を途中で見つけると投げる)、
 * 空いているのは末尾の一続きだけ。本体の行は動かさないし、消しもしない。
 *
 * 門は他と同じ二つ -- **表に有る**(abi の menus)ことと、**宣言に有る**こと。
 */
function menuPlace(anchor: Anchor, policy: ViewPolicy): Parameters<typeof mount>[2] | null {
  const name = anchor.menu ?? "";
  const spec = (abi.menus as Record<string, { id?: string; about?: string }>)[name];
  if (!spec?.id) {
    console.warn(`[tsubaki-actor] 表に無い menu: ${name}(abi/v1.json の menus)`);
    return null;
  }
  if (!(policy.menus ?? []).includes(name)) {
    console.warn(
      `[tsubaki-actor] ${name} は宣言されていないので、行を混ぜない` +
        "(drop.toml の [permissions] に menu = [...])",
    );
    return null;
  }
  const popup = document.getElementById(spec.id);
  if (!popup) {
    console.warn(`[tsubaki-actor] menu が見つからない: ${spec.id}`);
    return null;
  }
  return { parent: popup, tag: "vbox", id: anchor.id };
}

/**
 * その menu が「何についての menu か」を、行に伝える。
 *
 * popup が開くとき、右クリックされたタブに付いているこの drop 自身の目印を、
 * host に写す。**worker を一往復もしない** -- `popupshowing` は待てないし、
 * 返事を待つあいだに popup は塗られてしまうので、行の出し入れは CSS の側で
 * 閉じている必要がある(`#…menu:not([{attr}name]) .clear { display: none }`)。
 *
 * 写すのは自分の目印だけ。他の drop のものも、Firefox 自身の属性も、触らない。
 * そのとき押されたタブの id も一つ置いておく(`data-nora-tab`)ので、その行から
 * 起きた action には、どのタブのことかが入って届く(vnode.ts の factsOf)。
 *
 * host 自身は流れから消す(`display: contents`)。menu の中に箱が一つ挟まると、
 * 行の並びも高さも、本体のものと揃わなくなるので。
 */
function dressMenu(
  io: { listen(target: EventTarget, type: string, fn: (ev: Event) => void): void },
  host: Element,
  anchor: Anchor,
  mark: string,
  idOf: (tab: Element) => string,
): void {
  (host as HTMLElement).style.display = "contents";
  const spec = (abi.menus as Record<string, { about?: string }>)[anchor.menu ?? ""];
  const popup = host.parentElement;
  if (!popup || spec?.about !== "tab") return;
  const holder = abi.mark_attr.tab_holder;
  io.listen(popup, "popupshowing", () => {
    for (const attr of Array.from(host.attributes)) {
      if (attr.name.startsWith(mark)) host.removeAttribute(attr.name);
    }
    host.removeAttribute(holder);
    const tab = (window as unknown as { TabContextMenu?: { contextTab?: Element | null } })
      .TabContextMenu?.contextTab;
    if (!tab) return;
    for (const attr of Array.from(tab.attributes)) {
      if (attr.name.startsWith(mark)) host.setAttribute(attr.name, attr.value);
    }
    host.setAttribute(holder, idOf(tab));
  });
}

/** ツールバーの widget の名前。外す側(Drops.sys.mts)も、uuid から同じ名前を組む */
function widgetId(uuid: string): string {
  return `nora-widget-${uuid}`;
}

interface CustomizableUILike {
  PROVIDER_API: string;
  // deno-lint-ignore no-explicit-any
  createWidget(properties: Record<string, unknown>): any;
  getWidget(id: string):
    | { provider: string; forWindow(win: Window): { node: Element | null } | null }
    | null;
}

/**
 * 設定の頁の、この drop の一枚。about:nora:settings が、入っている drop ごとに
 * 空の箱(`#nora-drop-<uuid>`)を置くので、そこに入る。
 *
 * 頁のほうは preact で描かれるので、actor が先に着くことがある。だから **出て
 * くるのを待つ**。待ちかたを timeout にしないのは、「この drop の箱が無い頁」
 * (まだ入っていない、あるいは頁の作りが変わった)と「まだ描かれていない」を、
 * 待ち時間で見分けようとすると必ず間違うから -- 出てこなければ、ただ何も置かれ
 * ないだけで、見張りは drop を外すときに一緒に外れる。
 */
function settingsPlace(
  io: { defer(fn: () => void): void },
  uuid: string,
  anchor: Anchor,
): Promise<Parameters<typeof mount>[2] | null> {
  if (uuid === "") {
    console.warn('[tsubaki-actor] at: "settings": この drop の uuid が分からない');
    return Promise.resolve(null);
  }
  const id = `nora-drop-${uuid}`;
  const box = (el: Element | null) => (el ? { parent: el, tag: "html:div", id: anchor.id } : null);
  const found = document.getElementById(id);
  if (found) return Promise.resolve(box(found));
  return new Promise((resolve) => {
    const watch = new MutationObserver(() => {
      const el = document.getElementById(id);
      if (!el) return;
      watch.disconnect();
      resolve(box(el));
    });
    watch.observe(document.documentElement, { childList: true, subtree: true });
    io.defer(() => {
      watch.disconnect();
      resolve(null);
    });
  });
}

/** Where a host goes. The selector is looked up in this document; "body" by default. */
function placeOf(anchor: Anchor): Parameters<typeof mount>[2] {
  if (anchor.at === "keyset") {
    const main = document.getElementById("mainKeyset");
    if (!main) throw new Error('anchor at "keyset": #mainKeyset が無い(窓ではない document)');
    return { after: main, tag: "keyset", id: anchor.id };
  }
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
/** A pref whose string is JSON. `nothing` when it is unset, or unreadable. */
function readJsonPref(name: string): unknown {
  const text = Services.prefs.getStringPref(name, "");
  if (text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    console.warn("[tsubaki-actor] JSON として読めない pref:", name);
    return null;
  }
}
function writePref(name: string, value: unknown): void {
  if (typeof value === "boolean") Services.prefs.setBoolPref(name, value);
  else if (typeof value === "number") Services.prefs.setIntPref(name, Math.round(value));
  else if (typeof value === "string") Services.prefs.setStringPref(name, value);
  else console.warn("[tsubaki-actor] SetPref: bool / int / string のどれかで:", name, value);
}
