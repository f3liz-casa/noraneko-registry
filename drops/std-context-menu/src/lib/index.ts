// SPDX-License-Identifier: MPL-2.0

// std-context-menu: 本体の menu に行を混ぜるときの、DOM の作法。
//
// 門はここに無い。「その menu が表に有るか」「drop が宣言しているか」を見るのは
// 殻のほう -- 入れる人に見せる約束は、殻の仕事だから。ここが持っているのは、
// 約束が通ったあとの、三つの置きかた。

/** popupshowing を聞くのに要るぶんの ctx.io */
export interface IoListenLike {
  listen(target: EventTarget, type: string, fn: (ev: Event) => void): void;
}

export interface MenuRowsOptions {
  /** この drop の目印の接頭辞(`data-nora-<uuid>-`) */
  mark: string;
  /** 押されたタブの id を置く属性(`data-nora-tab`) */
  holder: string;
  /** その menu が「タブについての menu」なら true。目印を写すのはそのときだけ */
  aboutTab: boolean;
  /** タブ要素から、この窓のために鋳った id を引く */
  idOf(tab: Element): string;
}

/** 殻が(CSS を見て)隠した行。drop 自身が view で書いた hidden とは混ぜない */
const hidByLib = new WeakSet<Element>();

/**
 * host に作られた行を、popup の**直接の子**に出す。
 *
 * menupopup が行として組むのは、直接の子の menuitem / menu / menuseparator だけ。
 * あいだに箱が一つ挟まると、中身は一行も出ない -- `display: contents` でも同じで、
 * 箱が流れから消えるだけ、行は組まれないまま。
 *
 * それでも host は要る。popup をそのまま render 先にすると、preact はそこに元から
 * 居る本体の行を「余り」と見て消してしまう(mount の但し書き)。so: host は popup の
 * 直下に置いたまま**空**にしておいて、preact が host に作ったものを、その場で host の
 * 隣へ出す。preact は自分が作った node を覚えているので、親が変わっても属性の差分は
 * 当たるし、外すときは node の親から辿って消す(host ではなく popup から外れる)。
 *
 * 返すのは「popup に出した行」。目印を写す先は、host ではなくこちら。
 */
export function flattenMenu(host: Element): Element[] {
  const popup = host.parentElement;
  const rows: Element[] = [];
  if (!popup) return rows;

  const note = (kid: Node) => {
    if (kid.nodeType === 1) rows.push(kid as Element);
  };
  // mount がもう一枚目を render している。それを順番のまま host の隣へ
  let after: Node = host;
  for (const kid of Array.from(host.childNodes)) {
    popup.insertBefore(kid, after.nextSibling);
    note(kid);
    after = kid;
  }
  // 以後、preact が host に足すものも、同じところへ。next が popup 側に居るなら
  // その前(並びは preact が決めたとおり)、居なければ host のすぐ隣
  (host as unknown as { insertBefore: unknown }).insertBefore = function <T extends Node>(
    kid: T,
    ref: Node | null,
  ): T {
    popup.insertBefore(kid, ref && ref.parentNode === popup ? ref : host.nextSibling);
    note(kid);
    return kid;
  };
  return rows;
}

/**
 * その menu が「何についての menu か」を、行に伝える。
 *
 * popup が開くとき、右クリックされたタブに付いているこの drop 自身の目印を、
 * **その行たち**に写す。**worker を一往復もしない** -- `popupshowing` は待てないし、
 * 返事を待つあいだに popup は塗られてしまうので、行の出し入れは CSS の側で
 * 閉じている必要がある(`.clear:not([{attr}name]) { display: none }`)。
 *
 * そして写したあと、**CSS で消えた行には `hidden` を付ける**。menu が行を組むときに
 * 見るのは `hidden` 属性のほうで、`display: none` は届かない -- CSS だけ書いた drop は、
 * 消したつもりの行が出たままになる。ここで橋を渡しておけば、drop はこれまでどおり
 * CSS 一行で書ける。外すのは自分が付けたものだけ(drop が view で書いた `hidden` は、
 * その drop のもの)。
 *
 * 写すのは自分の目印だけ。他の drop のものも、Firefox 自身の属性も、触らない。
 * そのとき押されたタブの id も一つ置いておく(`holder`)ので、その行から起きた
 * action には、どのタブのことかが入って届く。
 */
export function dressMenu(io: IoListenLike, host: Element, rows: Element[], opts: MenuRowsOptions): void {
  const popup = host.parentElement;
  if (!popup) return;
  const { mark, holder, aboutTab, idOf } = opts;

  io.listen(popup, "popupshowing", () => {
    // 消えた行は、もう自分のものではない(preact が外したもの)
    const live = rows.filter((el) => el.isConnected);

    if (aboutTab) {
      for (const el of live) {
        for (const attr of Array.from(el.attributes)) {
          if (attr.name.startsWith(mark)) el.removeAttribute(attr.name);
        }
        el.removeAttribute(holder);
      }
      const tab = (window as unknown as { TabContextMenu?: { contextTab?: Element | null } })
        .TabContextMenu?.contextTab;
      if (tab) {
        for (const el of live) {
          for (const attr of Array.from(tab.attributes)) {
            if (attr.name.startsWith(mark)) el.setAttribute(attr.name, attr.value);
          }
          el.setAttribute(holder, idOf(tab));
        }
      }
    }

    // 目印が変わったので、CSS で消えた行に hidden を渡し直す。
    // **測る前に、前に自分が付けた hidden を外す** -- 付いたままだと display は
    // いつも none で、自分の影で二度と戻らなくなる。
    for (const el of live) {
      if (hidByLib.delete(el)) el.removeAttribute("hidden");
    }
    for (const el of live) {
      if (window.getComputedStyle(el).display === "none") {
        hidByLib.add(el);
        el.setAttribute("hidden", "true");
      }
    }
  });
}

/** 置いて、着せる。殻が menu の anchor に使うのは、だいたいこの一本 */
export function placeMenuRows(io: IoListenLike, host: Element, opts: MenuRowsOptions): Element[] {
  const rows = flattenMenu(host);
  dressMenu(io, host, rows, opts);
  return rows;
}
