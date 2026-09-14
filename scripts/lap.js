// SPDX-License-Identifier: MPL-2.0
//
// scripts/lap.rb が chrome context で走らせる一枚。引数は { stage, live, drops }、
// **done は最後の引数**(ExecuteAsyncScript の約束。args を渡すと前にずれる)。
//
// 本体の Drops 機構は通らないので、NoraActors.sys.mts と同じ形で actor を登録する
// (includeParent を渡さないと、親プロセスで開く about:newtab に actor が入らない)。
const done = arguments[arguments.length - 1];
const args = arguments[0];

(async () => {
  const out = { drops: [], did: [], told: [], errors: [] };
  try {
    const h = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsISubstitutingProtocolHandler);
    const sub = (name, url) => h.setSubstitution(name, Services.io.newURI(url));

    // 自分の別名と、deps の別名(版は drop.json から読むので、上がっても追随する)
    const seen = new Set();
    const info = {};
    for (const d of args.drops) {
      sub("live-" + d.dir, "file://" + args.live + "/" + d.dir + "/");
      const drop = JSON.parse(await IOUtils.readUTF8(args.stage + "/" + d.name + "/drop.json"));
      info[d.name] = drop;
      for (const dep of drop.deps ?? []) {
        const alias = `noraneko-dep-${dep.uuid}-${dep.version}`.replace(/[^a-z0-9]/gi, "-").toLowerCase();
        if (seen.has(alias)) continue;
        seen.add(alias);
        sub(alias, "file://" + args.stage + "/" + dep.name + "/_dist/lib/");
      }
    }

    // したこと、言い忘れ、転んだこと
    const didObs = { observe(_s, _t, data) { out.did.push(JSON.parse(data)); } };
    Services.obs.addObserver(didObs, "nora-drop-did");
    const logObs = {
      observe(subject) {
        const a = subject.wrappedJSObject && subject.wrappedJSObject.arguments;
        const s = a && a[0];
        if (typeof s !== "string") return;
        if (s.includes("drop.toml に足すなら")) out.told.push(s.replace(/\s+/g, " ").trim().slice(0, 200));
        else if (/failed|Error/.test(s) && /\[Nora|drop/i.test(s)) out.errors.push(s.slice(0, 200));
      },
    };
    Services.obs.addObserver(logObs, "console-api-log-event");

    const before = new Set([...(Services.wm.getMostRecentWindow("navigator:browser")?.document
      ?.querySelectorAll("[id]") ?? [])].map((e) => e.id));

    for (const d of args.drops) {
      const aj = JSON.parse(await IOUtils.readUTF8(args.stage + "/" + d.name + "/_dist/" + d.dir + "/actor.json"));
      const entry = {
        name: d.name,
        actor: aj.name,
        permissions: (aj.permissions ?? []).map((p) => p.name),
        matches: aj.matches ?? [],
        placed: [],
        // 殻(runTsubakiActor)を通る drop かどうか。drop.toml に [actor] がある
        // = actor.ts を書いていない = build が殻を着せた、ということ。
        // 自分で actor.ts を書いた drop は殻を通らないので、記録も出ない。
        shell: !!info[d.name]?.actor,
      };
      try {
        ChromeUtils.registerWindowActor(aj.name, {
          parent: { esModuleURI: `resource://live-${d.dir}/parent.sys.mjs` },
          child: {
            esModuleURI: `resource://live-${d.dir}/child.sys.mjs`,
            events: { [aj.event ?? "DOMContentLoaded"]: {} },
          },
          matches: aj.matches,
          allFrames: false,
          includeParent: aj.includeParent ?? true,
          ...(aj.includeChrome ? { includeChrome: true } : {}),
          ...(aj.safeForUntrustedWebProcess ? { safeForUntrustedWebProcess: true } : {}),
        });
      } catch (e) {
        out.errors.push(`${aj.name} を登録できなかった: ${String(e).slice(0, 120)}`);
      }
      out.drops.push(entry);
    }

    // 窓を一つ開く(もう開いている窓では、合図が過ぎている)
    const first = Services.wm.getMostRecentWindow("navigator:browser");
    first.OpenBrowserWindow();
    let win = null;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 400));
      const w = Services.wm.getMostRecentWindow("navigator:browser");
      if (w && w !== first) { win = w; break; }
    }
    if (!win) { done(Object.assign(out, { err: "窓が開かなかった" })); return; }
    // drop が置くまで待つ(worker が起きて、最初の一枚が返るまで)
    await new Promise((r) => setTimeout(r, 3500));

    // 置かれたもの: この窓に増えた id のうち、nora で始まるもの
    const now = [...win.document.querySelectorAll("[id^='nora']")].map((e) => e.id);
    for (const id of now) {
      if (before.has(id)) continue;
      // どの drop のものかは、id の頭で見当をつける(nora-<dir> / nora-<name の頭>)
      const owner = out.drops.find((d) => id.startsWith("nora-" + d.actor.replace(/^Nora/, "").toLowerCase())) ??
        out.drops.find((d) => id.includes(d.dir));
      (owner ?? out.drops[0]).placed.push(id);
    }

    // about: を見る drop があれば、そのページも一枚開いて、そこも見る
    for (const d of out.drops) {
      const abouts = (d.matches ?? []).map((m) => m.replace(/\*$/, "")).filter((m) => m.startsWith("about:"));
      if (abouts.length === 0) continue;
      for (const about of abouts) {
      const tab = win.gBrowser.addTab(about, {
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      });
      win.gBrowser.selectedTab = tab;
      await new Promise((r) => setTimeout(r, 3500));
      const doc = tab.linkedBrowser.contentDocument;
      if (!doc) { d.placed.push("(" + about + " は別プロセス、中が見えない)"); break; }
      for (const e of doc.querySelectorAll("[id^='nora'],[class*='nora']")) {
        d.placed.push(String(e.id || e.className).slice(0, 40));
      }
      // mount に id を渡していない drop は、id では探せない(newtab-hello がそれ)。
      // その drop の名前がページに出ていれば、置かれたことにする。
      if (d.placed.length === 0 && String(doc.body?.textContent ?? "").includes(d.name)) {
        d.placed.push("(" + about + " に id は無いが、名前がページに出ている)");
      }
      if (d.placed.length > 0) break;
      }
      if (d.placed.length === 0) d.placed.push("(" + abouts.join(" / ") + " のどれにも見つからない)");
    }

    await new Promise((r) => setTimeout(r, 1200));
    Services.obs.removeObserver(didObs, "nora-drop-did");
    Services.obs.removeObserver(logObs, "console-api-log-event");
  } catch (e) {
    out.err = String((e && e.stack) || e).slice(0, 400);
  }
  done(out);
})();
