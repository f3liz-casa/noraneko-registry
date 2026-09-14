// SPDX-License-Identifier: MPL-2.0

// std-settings: 設定の頁に、この drop の一枚を置くときの作法。
//
// about:nora:settings は、入っている drop ごとに空の箱(`#nora-drop-<uuid>`)を置く。
// 頁のほうは preact で描かれるので、actor が先に着くことがある -- だから
// **出てくるのを待つ**。
//
// 待ちかたを timeout にしていないのは、「この drop の箱が無い頁」(まだ入っていない、
// あるいは頁の作りが変わった)と「まだ描かれていない」を、待ち時間で見分けようと
// すると必ず間違うから。出てこなければ、ただ何も置かれないだけで、見張りは drop を
// 外すときに一緒に外れる。

import type { MountAt } from "std-preact-xul";

/** 見張りを片づけ台帳に載せるのに要るぶんの ctx.io */
export interface IoDeferLike {
  defer(fn: () => void): void;
}

/**
 * この drop の箱の中に、host を置く場所を返す。箱が出てこないまま drop が外れたら
 * `null`(何も置かない)。
 *
 * `id` は、その host に付ける id(drop の anchor が言ったもの)。
 */
export function settingsPlace(io: IoDeferLike, uuid: string, id?: string): Promise<MountAt | null> {
  if (uuid === "") {
    console.warn('[std-settings] at: "settings": この drop の uuid が分からない');
    return Promise.resolve(null);
  }
  const boxId = `nora-drop-${uuid}`;
  const at = (el: Element | null): MountAt | null =>
    el ? ({ parent: el, tag: "html:div", id } as MountAt) : null;

  const found = document.getElementById(boxId);
  if (found) return Promise.resolve(at(found));

  return new Promise((resolve) => {
    const watch = new MutationObserver(() => {
      const el = document.getElementById(boxId);
      if (!el) return;
      watch.disconnect();
      resolve(at(el));
    });
    watch.observe(document.documentElement, { childList: true, subtree: true });
    io.defer(() => {
      watch.disconnect();
      resolve(null);
    });
  });
}
