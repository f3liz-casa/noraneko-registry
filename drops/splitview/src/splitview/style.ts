// SPDX-License-Identifier: MPL-2.0

// この drop の CSS。本体のスタイルシートを消しに行くのではなく、[nora-split] が
// 付いている間だけ上に重ねる ── 属性が外れれば、元の二枚の分割ビューがそのまま
// 戻る。
//
// 覚えておくこと二つ(chrome://global/content/xul.css):
//   - tabpanels の子は既定で「見えないが読み上げには残る」(-moz-subtree-hidden-only-visually)。
//     例外は .deck-selected / .split-view-panel-active / .split-view-splitter の三つだけなので、
//     こちらで置く境も、同じことを自分で言う。
//   - tabpanels の子は grid-area: 1 / 1 ── 何も言わなければ全部が一枚に重なる。
//     置き場所は io/panels.ts が一枚ずつ inline で書く。

export const STYLE = `
/* 本体は #tabbrowser-tabpanels を display: flex にしている。分割ビューが出ている
   間だけ grid に替える(枚数と並べかたは grid-template が言う) */
#tabbrowser-tabpanels[nora-split] {
  display: grid;
}

/* 本体の splitter は「DOM の前の兄弟の width 属性」を動かす仕組みで、grid の
   並びとは噛み合わない。境は .nora-split-grip が持つ */
#tabbrowser-tabpanels[nora-split] > .split-view-splitter {
  display: none;
}

/* ペイン。flex を前提にした指定(幅の 49.4%、min/max-width、片側だけ潰した margin)を
   grid のものに置き換える。width は本体が inline で書き戻すことがあるので !important */
#tabbrowser-tabpanels[nora-split] > .split-view-panel[column] {
  min-width: 0;
  max-width: none;
  width: auto !important;
  margin: var(--space-xsmall);
}

/* 掴んでいる間、ページには手を出させない。捕まえてはいるが、ページの上を通ると
   カーソルがそちらの言うなりになる(境を持っているのに I ビームになる) */
#tabbrowser-tabpanels[nora-split-dragging] > .split-view-panel {
  pointer-events: none;
}

/* --- 境 ------------------------------------------------------------------ */

#tabbrowser-tabpanels > .nora-split-grip {
  -moz-subtree-hidden-only-visually: 0;
  visibility: inherit;
  z-index: 3;
  align-items: center;
  justify-content: center;
  -moz-user-focus: normal;
}

#tabbrowser-tabpanels > .nora-split-grip[data-axis="col"] {
  cursor: col-resize;
}

#tabbrowser-tabpanels > .nora-split-grip[data-axis="row"] {
  cursor: row-resize;
}

/* 掴めるのは 6px、見えるのは真ん中の 2px。掴みやすさと、細くありたいのは別のこと */
#tabbrowser-tabpanels > .nora-split-grip::before {
  content: "";
  display: block;
  border-radius: var(--border-radius-small, 4px);
  background-color: transparent;
  transition: background-color 150ms ease-in-out;
}

#tabbrowser-tabpanels > .nora-split-grip[data-axis="col"]::before {
  width: 2px;
  height: 100%;
}

#tabbrowser-tabpanels > .nora-split-grip[data-axis="row"]::before {
  width: 100%;
  height: 2px;
}

#tabbrowser-tabpanels > .nora-split-grip:hover::before,
#tabbrowser-tabpanels > .nora-split-grip:focus-visible::before {
  background-color: var(--focus-outline-color);
}

#tabbrowser-tabpanels[nora-split-dragging] > .nora-split-grip::before {
  background-color: var(--focus-outline-color);
}

/* --- 並べかたを選ぶ絵(#split-view-menu の頭) ----------------------------- */

.nora-split-picker {
  padding: 6px 8px 2px;
  gap: 6px;
}

.nora-split-shape {
  appearance: none;
  padding: 5px;
  border-radius: var(--border-radius-small, 4px);
  border: 1px solid transparent;
}

.nora-split-shape:hover {
  background-color: color-mix(in srgb, currentColor 10%, transparent);
}

.nora-split-shape[selected="true"] {
  border-color: var(--focus-outline-color);
}

/* 絵そのもの。いまの枚数で、その並べかたが実際どう見えるか */
.nora-split-shape-art {
  display: grid;
  gap: 2px;
  width: 34px;
  height: 24px;
}

.nora-split-shape-cell {
  background-color: currentColor;
  opacity: 0.4;
  border-radius: 2px;
}

.nora-split-shape[selected="true"] .nora-split-shape-cell {
  opacity: 0.9;
}

/* --- ペインの隅の二つ ---------------------------------------------------- */

/* 本体の footer は「いま見ていないほう」にしか出ない。見ているペインのぶんは、
   カーソルが来たときだけ ── 常に何かが乗っているページにはしたくない */
#tabbrowser-tabpanels[nora-split] > .split-view-panel.deck-selected:hover split-view-footer {
  display: flex;
}

split-view-footer .nora-split-act {
  appearance: none;
  padding: 2px;
  border-radius: var(--border-radius-small, 4px);
  -moz-context-properties: fill;
  fill: currentColor;
  opacity: 0;
  transition: opacity 120ms ease-in-out;
}

split-view-footer:hover .nora-split-act,
split-view-footer .nora-split-act:focus-visible {
  opacity: 1;
}

split-view-footer .nora-split-act:hover {
  background-color: color-mix(in srgb, currentColor 14%, transparent);
}

split-view-footer .nora-split-act .toolbarbutton-icon {
  width: 14px;
  height: 14px;
}

/* --- タブを落とす先の予告 ------------------------------------------------ */

#tabbrowser-tabpanels > .nora-split-hint {
  -moz-subtree-hidden-only-visually: 0;
  visibility: inherit;
  /* grid item のまま absolute にすると、囲いが一つ目のセルになる。全面を囲いに */
  grid-area: 1 / 1 / -1 / -1;
  position: absolute;
  z-index: 5;
  pointer-events: none;
  margin: var(--space-xsmall);
  border-radius: var(--border-radius-medium, 8px);
  border: 2px solid var(--focus-outline-color);
  background-color: color-mix(in srgb, var(--focus-outline-color) 20%, transparent);
}
`;
