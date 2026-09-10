// SPDX-License-Identifier: MPL-2.0

// splitview: 本体の分割ビューを、二枚から四枚へ。
//
// Firefox 155 は分割ビューを持っている。tabbrowser の API(addTabSplitView /
// showSplitViewPanels / tabpanels.splitViewPanels)は枚数を数えていない ── 三枚
// 渡せば三枚受け取る。止めているのは UI と CSS のほうで、並べかたを言う口が無く、
// 置き場所が column="0" と "1" の order しか用意されていない。
//
// だからこの drop がすることは、機能を足すというより、そこを開けること:
//
//   io/panels.ts  ペインの箱を grid に置き直す(芯。掴むのは setSplitViewActive 一つ)
//   io/grips.ts   境を持つ。動かしている最中に中身がついてくる
//   io/menu.ts    タブの右クリックから、三枚目・四枚目を足す / このペインを外す
//   io/picker.ts  並べかたを絵から選ぶ(Windows の、あの格子)
//   io/footer.ts  ペインの隅に、閉じる と ひとりにする
//   io/tabdrop.ts タブを掴んでページの上に落とすと、そこが分割になる
//
// 窓に置いたものは全部 ctx.io を通っているので、外せば元の二枚の分割ビューが
// そのまま戻る(docs/LAYERS.md)。
//
// この actor は browser.xhtml そのものに効くので、content hook はブラウザの窓の
// 中で動く(window は ChromeWindow、gBrowser が手の届くところにある)。

import {
  defineContent,
  defineParent,
  type ActorMeta,
  type ContentCtx,
} from "../_shared/defineActor.ts";
import type { ChromeWindow } from "./chrome.ts";
import { STYLE } from "./style.ts";
import { makeGrid } from "./io/panels.ts";
import { makeGrips, type Grips } from "./io/grips.ts";
import { makePicker, type Picker } from "./io/picker.ts";
import { makeFooters, type Footers } from "./io/footer.ts";
import { addMenuRows } from "./io/menu.ts";
import { makeTabDrop } from "./io/tabdrop.ts";
import { PREFS } from "./io/prefs.ts";

export const meta: ActorMeta = {
  id: "splitview@noraneko.app",
  version: "1.0.0",
  namespace: "noraSplitView",
  matches: ["chrome://browser/content/browser.xhtml"],
  runAt: "document_end",
};

export const parent = defineParent({});

export const content = defineContent<typeof parent>((_parent, ctx) => {
  main(ctx).catch((e) => console.error("[splitview] failed:", e));
});

async function main(ctx: ContentCtx): Promise<void> {
  const win = window as unknown as ChromeWindow;
  const doc = document;
  // popup の窓(window.open で開いたもの)にはタブの列も分割ビューも無い
  if ((doc.documentElement.getAttribute("chromehidden") ?? "").includes("toolbar")) return;
  await win.delayedStartupPromise;

  ctx.io.style(doc, STYLE);

  // 形が変わったら知りたいものが三つある(境、並べかたの絵、ペインの隅のボタン)。
  // 形を決めるのは grid のほうなので、先に名前だけ用意して、繋ぐ
  let grips: Grips | null = null;
  let picker: Picker | null = null;
  let footers: Footers | null = null;
  const grid = makeGrid(ctx.io, win, () => {
    grips?.update();
    picker?.update();
    footers?.update();
  });
  grips = makeGrips(ctx.io, win, grid);
  picker = makePicker(ctx.io, win, grid);
  footers = makeFooters(ctx.io, win, grid);

  addMenuRows(ctx.io, win);
  makeTabDrop(ctx.io, win, grid);

  // 並べかたと境は pref に居る。about:config から書き換えても、別の窓で変えても、
  // その場で効く
  for (const name of PREFS) ctx.io.pref(name, () => grid.arrange());

  // この窓にもう分割ビューが出ているかもしれない(drop を入れた瞬間、再起動なしで)
  grid.arrange();
}
