// SPDX-License-Identifier: MPL-2.0
//
// 走らせてみる:  mise exec -- deno run -A drops/std-prefs/check.ts
//
// Firefox の外で確かめられるのはここまで: about:config を Map で真似て、
// 既定値・書き・戻し・引っ越し・外からの変更が signal に届くところまでを見る。
// 本当の pref と本当の窓は、drop を入れてからでないと分からない。

type V = boolean | number | string;
const user = new Map<string, V>();
const defaults = new Map<string, V>();
const observers = new Map<string, (() => void)[]>();
const fire = (name: string) => (observers.get(name) ?? []).forEach((f) => f());
const read = (name: string, fallback: V, kind: string) => {
  const v = user.has(name) ? user.get(name)! : defaults.has(name) ? defaults.get(name)! : fallback;
  if (typeof v !== kind) throw new Error(`${name}: ${typeof v} ではなく ${kind} を頼まれた`);
  return v;
};
const write = (name: string, v: V) => {
  user.set(name, v);
  fire(name);
};
(globalThis as unknown as { Services: unknown }).Services = {
  prefs: {
    getBoolPref: (n: string, d: boolean) => read(n, d, "boolean"),
    getIntPref: (n: string, d: number) => read(n, d, "number"),
    getStringPref: (n: string, d: string) => read(n, d, "string"),
    setBoolPref: write,
    setIntPref: write,
    setStringPref: write,
    prefHasUserValue: (n: string) => user.has(n),
    clearUserPref: (n: string) => {
      user.delete(n);
      fire(n);
    },
    getDefaultBranch: () => ({
      setBoolPref: (n: string, v: boolean) => defaults.set(n, v),
      setIntPref: (n: string, v: number) => defaults.set(n, v),
      setStringPref: (n: string, v: string) => defaults.set(n, v),
    }),
  },
};

// Services が居てから読む(module の頭で default branch に触るので)
const { adoptPref, definePrefs, pref, watchPrefs } = await import("./src/lib/index.ts");

const io = {
  pref: (name: string, fn: () => void) => observers.set(name, [...(observers.get(name) ?? []), fn]),
};

let wrong = 0;
const ok = (what: string, got: unknown, want: unknown) => {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (!same) wrong++;
  console.log(`${same ? "ok  " : "NG  "} ${what}: ${JSON.stringify(got)}${same ? "" : ` != ${JSON.stringify(want)}`}`);
};

// 昔のまとめられた pref が、もうそこにある
user.set("floorp.panelSidebar.config", JSON.stringify({ globalWidth: 320, position_start: true, junk: "x" }));

const prefs = definePrefs("noraneko.check", {
  globalWidth: pref.int(400),
  positionStart: pref.bool(false),
  tabs: { style: pref.choice(["proton", "photon"], "proton"), names: pref.json<string[]>([]) },
});

ok("名前は道のまま", prefs.tabs.style.name, "noraneko.check.tabs.style");
ok("既定は default branch に置かれる", defaults.get("noraneko.check.globalWidth"), 400);
ok("既定を読む", prefs.globalWidth.value, 400);
ok("まだ手が入っていない", prefs.globalWidth.hasUserValue, false);

ok("引っ越した", adoptPref(prefs.globalWidth, "floorp.panelSidebar.config", "globalWidth"), true);
ok("引っ越した値", prefs.globalWidth.value, 320);
ok("二度目はしない", adoptPref(prefs.globalWidth, "floorp.panelSidebar.config", "globalWidth"), false);
ok("bool も", adoptPref(prefs.positionStart, "floorp.panelSidebar.config", "position_start"), true);
ok("無い key は黙って見送る", adoptPref(prefs.tabs.style, "floorp.panelSidebar.config", "nope"), false);
ok("json には引っ越さない", adoptPref(prefs.tabs.names, "floorp.panelSidebar.config", "junk"), false);
ok("無い pref からも", adoptPref(prefs.tabs.style, "no.such.pref", "x"), false);

prefs.globalWidth.set(500);
ok("書いた", user.get("noraneko.check.globalWidth"), 500);
ok("読み直した", prefs.globalWidth.value, 500);

prefs.globalWidth.reset();
ok("戻した", prefs.globalWidth.value, 400);
ok("手が抜けた", prefs.globalWidth.hasUserValue, false);

watchPrefs(io, prefs);
const seen: number[] = [];
prefs.globalWidth.signal.subscribe((v) => seen.push(v));
user.set("noraneko.check.globalWidth", 640);
fire("noraneko.check.globalWidth");
ok("外の変更が signal に", prefs.globalWidth.value, 640);
ok("subscribe は最初の一回 + 変わった分", seen, [400, 640]);

user.set("noraneko.check.tabs.style", "lepton");
fire("noraneko.check.tabs.style");
ok("知らない選択肢は既定に", prefs.tabs.style.value, "proton");
prefs.tabs.style.set("photon");
ok("choice を書く", prefs.tabs.style.value, "photon");

prefs.tabs.names.set(["a", "b"]);
ok("json を書く", user.get("noraneko.check.tabs.names"), '["a","b"]');
let redraws = 0;
prefs.tabs.names.signal.subscribe(() => redraws++);
fire("noraneko.check.tabs.names");
ok("同じ中身で signal は動かない", redraws, 1);
user.set("noraneko.check.tabs.names", '["a","c"]');
fire("noraneko.check.tabs.names");
ok("変われば動く", prefs.tabs.names.value, ["a", "c"]);

user.set("noraneko.check.positionStart", "true");
fire("noraneko.check.positionStart");
ok("about:config で型を取り違えられても既定で立つ", prefs.positionStart.value, false);

console.log(wrong === 0 ? "\nぜんぶ通った" : `\n${wrong} 個 転んだ`);
if (wrong > 0) Deno.exit(1);
