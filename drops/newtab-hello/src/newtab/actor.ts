// SPDX-License-Identifier: MPL-2.0

// newtab-hello: built-in の newtab actor(Activity Stream のデータを新しいタブに渡す)に、
// 「この新しいタブは drop から来ている」と目で分かる一行を足したもの。
//
// 変わるところは二つだけ:
// - parent に opened() を足す。親プロセスで数える(この session で新しいタブを開いた回数)。
//   数が増えるのは、drop の actor.mjs が親で走っている証拠。
// - content で、ページの左下に小さく「drop newtab-hello · <版> · n 回目」を置く。
// データの取りかた(getData)は built-in と同じ。

import {
  defineContent,
  defineParent,
  type ActorMeta,
} from "../_shared/defineActor.ts";
import { h, mount } from "std";
import { Note } from "./ui/Note.tsx";

export const meta: ActorMeta = {
  id: "about-newtab@noraneko.app",
  version: "1.0.2",
  namespace: "noraNewTab",
  matches: ["about:home*", "about:welcome", "about:newtab*"],
  runAt: "document_start",
};

let opened = 0;

export const parent = defineParent({
  async getData(): Promise<{ topSites: unknown[]; highlights: unknown[] }> {
    try {
      const { NewTabUtils } = ChromeUtils.importESModule(
        "resource://gre/modules/NewTabUtils.sys.mjs",
      );
      const [topSites, highlights] = await Promise.all([
        NewTabUtils.activityStreamLinks.getTopSites({
          withFavicons: true,
          numItems: 16,
        }),
        NewTabUtils.activityStreamLinks.getHighlights({
          withFavicons: true,
          numItems: 16,
        }),
      ]);
      return { topSites: topSites ?? [], highlights: highlights ?? [] };
    } catch (e) {
      console.error("[noraneko] newtab: failed to load data:", e);
      return { topSites: [], highlights: [] };
    }
  },
  // この session で、新しいタブを開いた回数(親プロセスの変数。ブラウザを閉じると 0 に戻る)
  async opened(): Promise<number> {
    opened += 1;
    return opened;
  },
});

export const content = defineContent<typeof parent>((parent, ctx) => {
  // 置くのは ctx.io / ctx.ui を通す。drop を外したとき、この一行も listener も一緒に戻る
  ctx.io.listen(window, "DOMContentLoaded", async () => {
    const data = await parent.getData();
    window.dispatchEvent(
      new window.CustomEvent("noranekoNewtabData", { detail: data }),
    );

    const n = await parent.opened();
    // the words come from ops/hello.tsubaki (Tsubaki, in std-tsubaki-runtime's wasm); the view only shows them
    await ctx.ops!.load("ops/hello.tsubaki");
    const text = (await ctx.ops!.call("greet", "newtab-hello", meta.version, n)) as string;
    mount(ctx.io, h(Note, { text }), {
      parent: document.body,
      tag: "html:div",
    });
  });
});
