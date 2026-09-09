// SPDX-License-Identifier: MPL-2.0

// Codegen + bundle orchestrator for actors.
//
// For each <name>/actor.ts it generates a small xpi into _dist/<name>/, shaped
// like Firefox's own about:newtab add-on: the xpi is only a container (manifest.json
// with id/version/hidden), and the page side is a JSWindowActor pair:
//   actor.json      registration options (name, matches, events, methods)
//   parent.sys.mjs  JSWindowActorParent: receiveMessage → parent[method](...args)
//   child.sys.mjs   JSWindowActorChild: loads content.js into the page's process
//   actor.mjs       parent methods (bundled by tsdown)
//   content.js      content hook + runtime (bundled by tsdown, IIFE)
// The .sys.mjs files reference resource://noraneko-builtin/<name>/; build-drop.rb
// rewrites that to the drop's own resource alias.
//
// The actor module's top level must be pure: this script imports it under Deno
// to read `meta` and the parent method names, so it must not touch Firefox
// globals (Services, ChromeUtils, window, ...) outside of method/hook bodies.

import * as path from "@std/path";

const ROOT = path.dirname(path.fromFileUrl(import.meta.url));
const DIST = path.join(ROOT, "_dist");
const GEN = path.join(ROOT, "_gen");

const mode =
  Deno.args
    .find((a) => a.startsWith("--env.MODE="))
    ?.slice("--env.MODE=".length) ?? "dev";

interface ActorMeta {
  id: string;
  version: string;
  namespace: string;
  matches: string[];
  runAt?: string;
  actor?: string;
  replaces?: string;
}

/** JSWindowActor name: meta.actor, or "Nora" + PascalCase(dir) (newtab → NoraNewtab, about-preferences → NoraAboutPreferences) */
function actorName(a: Actor): string {
  return a.meta.actor ?? "Nora" + a.dir.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
}

/** runAt → the child actor event that starts the content hook */
function runAtEvent(a: Actor): string {
  switch (a.meta.runAt ?? "document_end") {
    case "document_start": return "DOMDocElementInserted";
    case "document_idle": return "load";
    default: return "DOMContentLoaded";
  }
}

/** One dependency, resolved by the registry's build.rb (drop.toml [deps] → uuid + the version in the registry tree) */
interface Dep {
  name: string;
  uuid: string;
  version: string; // semver, e.g. 1.0.0 — the dl keeps /drop/<uuid>/v/<semver>/
  lib: boolean; // has lib.js (loaded into the content scope before content.js)
  wasm: boolean; // has wasm/ (the Tsubaki runtime: ctx.ops)
  ops: boolean; // has ops/*.tsubaki (words the logic is given before its own: std.tsubaki)
}
/** _stage/<name>/drop.json: what the registry knows about this drop. Absent for the built-ins. */
interface DropInfo {
  name: string;
  uuid: string;
  version?: string; // lib drops: their own semver
  lib?: boolean;
  deps: Dep[];
  /** drop.toml の [actor]: actor.ts を書かない drop(actor も Tsubaki)の meta */
  actor?: {
    id?: string;
    namespace?: string;
    version?: string;
    run_at?: string;
    name?: string;
    matches?: string[];
    /** view に <browser> を書ける、という宣言。actor.json に写して、入れる人に見せる */
    web_frame?: boolean;
  };
}
const DROP: DropInfo | null = (() => {
  try {
    return JSON.parse(Deno.readTextFileSync(path.join(ROOT, "drop.json")));
  } catch {
    return null;
  }
})();
const DEPS: Dep[] = DROP?.deps ?? [];
/** The name a dep's lib.js binds in the scope (and the name the bundler maps the import to) */
export const depGlobal = (name: string) => "nora_dep_" + name.replace(/[^a-z0-9]/gi, "_");
/** resource alias of a dep: noraneko-dep-<uuid>-<semver> (Drops.sys.mts sets it; the same rule) */
const depAlias = (d: Dep) => `noraneko-dep-${d.uuid}-${d.version}`.replace(/[^a-z0-9]/gi, "-").toLowerCase();

/** It keeps logic in Tsubaki -- its own wasm/, or a dep that ships one (std). */
const wantsOps = (a: Actor) => a.wasm || DEPS.some((d) => d.wasm);
/** The worker that logic lives in (see genOpsWorker). */
const OPS_WORKER = "ops-worker.js";
/**
 * What the runtime is given before the drop's own ops: every dep's
 * ops/*.tsubaki, in the order the deps are loaded. `rel` is where the file ends
 * up under the actor's own base ("ops/std-tsubaki-runtime/std.tsubaki").
 */
function preludeFiles(): Array<{ from: string; rel: string }> {
  const files: Array<{ from: string; rel: string }> = [];
  for (const d of DEPS.filter((x) => x.ops)) {
    const dir = path.join(ROOT, "_deps", d.name, "ops");
    const names = [...Deno.readDirSync(dir)].filter((e) => e.isFile && e.name.endsWith(".tsubaki")).map((e) => e.name);
    for (const name of names.sort()) files.push({ from: path.join(dir, name), rel: `ops/${d.name}/${name}` });
  }
  return files;
}
/** Where the Tsubaki runtime's glue is: a dep's wasm/ (std) or this actor's own. */
const runtimeBase = (a: Actor) => {
  const d = DEPS.find((x) => x.wasm);
  return d ? `resource://${depAlias(d)}/wasm/` : `resource://noraneko-builtin/${a.dir}/wasm/`;
};

interface Actor {
  dir: string;
  meta: ActorMeta;
  methods: Array<{ name: string; arity: number }>;
  /** <dir>/wasm/main.bc.wasm.js exists: the actor keeps its logic in Tsubaki */
  wasm: boolean;
}

/**
 * actor.ts を書かない drop: ops/*.tsubaki と drop.toml の [actor] だけ。
 * その二つから、どの drop でも同じ形の actor.ts をここで書く(stage の中だけ。
 * xpi の source/ にも入るので、入れる人はこの殻もそのまま読める)。
 */
function writeTsubakiActors(): void {
  for (const entry of Deno.readDirSync(ROOT)) {
    if (!entry.isDirectory || entry.name.startsWith("_") || entry.name === "node_modules") continue;
    const dir = path.join(ROOT, entry.name);
    if (exists(path.join(dir, "actor.ts")) || !exists(path.join(dir, "ops"))) continue;
    const a = DROP?.actor;
    if (!a) throw new Error(`${entry.name}: actor.ts が無い drop には drop.toml の [actor] が要る`);
    for (const field of ["id", "namespace", "version", "matches"] as const) {
      if (!a[field] || (field === "matches" && a.matches?.length === 0)) {
        throw new Error(`${entry.name}: drop.toml の [actor] に ${field} が無い`);
      }
    }
    const files = [...Deno.readDirSync(path.join(dir, "ops"))]
      .filter((e) => e.isFile && e.name.endsWith(".tsubaki"))
      .map((e) => `ops/${e.name}`)
      .sort();
    if (files.length === 0) throw new Error(`${entry.name}: ops/*.tsubaki が無い`);
    const meta = {
      id: a.id,
      version: a.version,
      namespace: a.namespace,
      matches: a.matches,
      ...(a.run_at ? { runAt: a.run_at } : {}),
      ...(a.name ? { actor: a.name } : {}),
    };
    // what the view may name beyond the ordinary vocabulary (_shared/vnode.ts)
    const policy = a.web_frame ? { webFrame: true } : {};
    Deno.writeTextFileSync(
      path.join(dir, "actor.ts"),
      `// SPDX-License-Identifier: MPL-2.0
// GENERATED by build.ts. この drop の actor は Tsubaki で書かれている:
// 直すのは ${files.join(" / ")} と drop.toml の [actor]。
//
// 殻は _shared/tsubakiActor.ts。logic が答える三つの door(setup / start / dispatch)
// を呼んで、返ってきた view を描き、effects を carry out する。

import { defineContent, defineParent, type ActorMeta } from "../_shared/defineActor.ts";
import { runTsubakiActor } from "../_shared/tsubakiActor.ts";

export const meta: ActorMeta = ${JSON.stringify(meta, null, 2)};

export const parent = defineParent({});

export const content = defineContent<typeof parent>((_parent, ctx) => {
  runTsubakiActor(ctx, ${JSON.stringify(files)}, ${JSON.stringify(policy)}).catch((e) =>
    console.error("[${entry.name}] failed:", e)
  );
});
`,
    );
    console.log(`[webext-actors] ${entry.name}: actor は Tsubaki(${files.join(", ")})。標準の actor.ts を書いた`);
  }
}

function exists(p: string): boolean {
  try {
    Deno.statSync(p);
    return true;
  } catch {
    return false;
  }
}

function discoverActorDirs(): string[] {
  const dirs: string[] = [];
  for (const entry of Deno.readDirSync(ROOT)) {
    if (!entry.isDirectory) continue;
    if (entry.name.startsWith("_") || entry.name === "node_modules") continue;
    try {
      Deno.statSync(path.join(ROOT, entry.name, "actor.ts"));
      dirs.push(entry.name);
    } catch {
      // no actor.ts here
    }
  }
  return dirs.sort();
}

async function loadActor(dir: string): Promise<Actor> {
  const mod = await import(
    path.toFileUrl(path.join(ROOT, dir, "actor.ts")).href
  );
  const meta = mod.meta as ActorMeta;
  const parent = mod.parent as Record<string, (...a: unknown[]) => unknown>;
  const methods = Object.keys(parent).map((name) => ({
    name,
    arity: parent[name].length,
  }));
  let wasm = false;
  try {
    Deno.statSync(path.join(ROOT, dir, "wasm", "main.bc.wasm.js"));
    wasm = true;
  } catch {
    // no wasm here
  }
  return { dir, meta, methods, wasm };
}

// wasm/ (the Tsubaki glue + .wasm) and ops/*.tsubaki go into _dist/<dir>/ as
// they are: the child loads them by URL at run time.
function copyTree(from: string, to: string): void {
  Deno.mkdirSync(to, { recursive: true });
  for (const e of Deno.readDirSync(from)) {
    const src = path.join(from, e.name);
    const dst = path.join(to, e.name);
    if (e.isDirectory) copyTree(src, dst);
    else Deno.copyFileSync(src, dst);
  }
}
function copyRuntimeFiles(a: Actor): void {
  if (a.wasm) copyTree(path.join(ROOT, a.dir, "wasm"), path.join(DIST, a.dir, "wasm"));
  // A dep's ops are copied in beside this actor's own, under the dep's name, and
  // read from here at run time. They are text, and small: carrying them rather
  // than fetching them from the dep's own resource:// keeps `load` on the one
  // path that is known to work (a jar-backed resource:// refuses fetch()), and
  // puts what the logic was given in the drop's own source/ where it is read.
  for (const { from, rel } of preludeFiles()) {
    Deno.mkdirSync(path.dirname(path.join(DIST, a.dir, rel)), { recursive: true });
    Deno.copyFileSync(from, path.join(DIST, a.dir, rel));
  }
  const ops = path.join(ROOT, a.dir, "ops");
  try {
    for (const e of Deno.readDirSync(ops)) {
      if (e.isFile && e.name.endsWith(".tsubaki")) {
        Deno.mkdirSync(path.join(DIST, a.dir, "ops"), { recursive: true });
        Deno.copyFileSync(path.join(ops, e.name), path.join(DIST, a.dir, "ops", e.name));
      }
    }
  } catch {
    // no ops/ here
  }
}

function genManifest(a: Actor): string {
  // Container only (like newtab@mozilla.org): id / version / hidden. No content_scripts,
  // no experiment_apis, no background. Everything runs through the JSWindowActor pair.
  const manifest = {
    manifest_version: 2,
    name: a.dir,
    version: a.meta.version,
    browser_specific_settings: { gecko: { id: a.meta.id } },
    hidden: true,
  };
  return JSON.stringify(manifest, null, 2) + "\n";
}

/** Registration options + what a person can read before installing (methods, pages) */
function genActorJson(a: Actor): string {
  const web = a.meta.matches.some((m) => /^(\*|https?):\/\//.test(m));
  // the browser window itself (chrome://browser/content/browser.xhtml): the content hook then
  // runs inside that window, with gBrowser and everything else in reach
  const chrome = a.meta.matches.some((m) => m.startsWith("chrome://browser/"));
  const j = {
    name: actorName(a),
    id: a.meta.id,
    version: a.meta.version,
    matches: a.meta.matches,
    event: runAtEvent(a),
    methods: a.methods.map((m) => m.name),
    replaces: a.meta.replaces ?? null,
    // pages in the parent process (chrome://, about:preferences) and in every content process
    // (about:newtab lives in "privilegedabout"). Web pages only when a match says so (dev localhost).
    includeParent: true,
    ...(DEPS.length ? { deps: DEPS } : {}),
    includeChrome: chrome,
    safeForUntrustedWebProcess: web,
    // "ページを読み込む窓を置く": this drop's view may say <browser>. Only a drop
    // whose actor is written in Tsubaki declares it (drop.toml [actor]); one
    // that writes its own actor.ts could always make one, and says so by being
    // JS that a reviewer reads line by line.
    webFrame: DROP?.actor?.web_frame === true,
  };
  return JSON.stringify(j, null, 2) + "\n";
}

function genParentModule(a: Actor): string {
  const name = actorName(a);
  return `// SPDX-License-Identifier: MPL-2.0
// GENERATED by build.ts. Edit ${a.dir}/actor.ts instead.
//
// JSWindowActorParent for ${name}: every sendQuery(method, args) from the child
// becomes parent[method](...args) in the main process (actor.mjs).

const METHODS = [${a.methods.map((m) => `"${m.name}"`).join(", ")}];

export class ${name}Parent extends JSWindowActorParent {
  async receiveMessage(message) {
    if (!METHODS.includes(message.name)) {
      throw new Error(\`${name}: unknown method \${message.name}\`);
    }
    const { parent } = ChromeUtils.importESModule(
      "resource://noraneko-builtin/${a.dir}/actor.mjs",
    );
    return parent[message.name](...(message.data ?? []));
  }
}
`;
}

function genChildModule(a: Actor): string {
  const name = actorName(a);
  return `// SPDX-License-Identifier: MPL-2.0
// GENERATED by build.ts. Edit ${a.dir}/actor.ts instead.
//
// JSWindowActorChild for ${name}: on ${runAtEvent(a)} it loads content.js into this
// process with \`window\` / \`document\` / \`exportFunction\` / \`__nora\` on the scope
// chain (loadSubScript), so the content hook reads like a content script but runs
// with this actor's privileges. It is the same shape as Firefox's AboutNewTabChild.

export class ${name}Child extends JSWindowActorChild {
  #ran = false;
  #onDestroy = [];
${wantsOps(a) ? tsubakiWorker(a) : ""}
  handleEvent(event) {
    if (event.type !== "${runAtEvent(a)}" || this.#ran) return;
    this.#ran = true;
    const win = this.contentWindow;
    if (!win) return;
    const actor = this;
    const scope = {
      window: win,
      document: win.document,
      exportFunction: (fn, target, options) => Cu.exportFunction(fn, target, options),
      // timers of the window, not of this module's global (which has none):
      // preact's hooks schedule effects with them, and they stop with the window
      setTimeout: win.setTimeout.bind(win),
      clearTimeout: win.clearTimeout.bind(win),
      requestAnimationFrame: win.requestAnimationFrame.bind(win),
      cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
      queueMicrotask: win.queueMicrotask.bind(win),
      __nora: {
        call: (method, args) => actor.sendQuery(method, args),
        expose(funcs) {
          for (const [n, fn] of Object.entries(funcs)) {
            Cu.exportFunction(fn, win, { defineAs: n });
          }
        },
        onDestroy: (fn) => actor.#onDestroy.push(fn),
        base: "resource://noraneko-builtin/${a.dir}/",
        ${wantsOps(a) ? "tsubaki: actor.#tsubaki()," : "tsubaki: undefined,"}
      },
    };
    try {
${DEPS.filter((d) => d.lib).map((d) => `      // dep ${d.name} ${d.version}: binds ${depGlobal(d.name)} in the scope
      Services.scriptloader.loadSubScriptWithOptions("resource://${depAlias(d)}/lib.js", { target: scope, ignoreCache: true });`).join("\n")}
      Services.scriptloader.loadSubScript(
        "resource://noraneko-builtin/${a.dir}/content.js",
        scope,
      );
    } catch (e) {
      console.error("[${name}] content.js failed:", e);
    }
  }

  // The actor was unregistered (drop removed or replaced) or the window is going
  // away: give the content hook its chance to put things back. Last placed,
  // first taken out (a view is unmounted before the box it was mounted in goes).
  didDestroy() {
    for (const fn of this.#onDestroy.splice(0).reverse()) {
      try {
        fn();
      } catch (e) {
        console.error("[${name}] cleanup failed:", e);
      }
    }
  }
}
`;
}

// The actor keeps its logic in Tsubaki (wasm/), and it runs in a ChromeWorker of
// this actor's own -- one per window, terminated when the actor goes.
//
// A worker, rather than the thread the view is on, because of where the ceiling
// is: Firefox treats wasm compilation as eval and refuses it in the parent
// process (a browser-window actor IS the parent process), and no principal gets
// around that on the main thread. Inside a worker, wasm is governed by the
// worker's own CSP and nothing else -- see ContentSecurityPolicyAllows in
// dom/workers/RuntimeService.cpp, where only `eval` goes through
// nsContentSecurityUtils. A ChromeWorker has no CSP, so compiling there is an
// ordinary thing. Measured before it was built on: main thread "blocked by
// CSP", worker ok, with this very runtime.
//
// It is the better shape anyway: the logic is off the view's thread, there is
// no second process to keep, and what crosses postMessage is structured-cloned
// -- which the drop's own data (a state, an action, a frame of view and
// effects) already is. Closures never cross, and never needed to.
function tsubakiWorker(a: Actor): string {
  const name = actorName(a);
  return `
  #tsubaki() {
    const worker = new ChromeWorker("resource://noraneko-builtin/${a.dir}/${OPS_WORKER}", {
      name: "${name} tsubaki",
    });
    const waiting = new Map();
    let n = 0;
    worker.onmessage = (event) => {
      const { id, ok, err } = event.data;
      const pending = waiting.get(id);
      if (!pending) return;
      waiting.delete(id);
      if (err === undefined) pending.resolve(ok);
      else pending.reject(new Error(err));
    };
    worker.onerror = (event) => {
      console.error("[${name} tsubaki]", event.message ?? event);
    };
    const ask = (op, data) =>
      new Promise((resolve, reject) => {
        const id = ++n;
        waiting.set(id, { resolve, reject });
        worker.postMessage({ id, op, ...data });
      });
    // the runtime's glue and this actor's own files: the worker is handed both
    // URLs rather than knowing them, so build-drop.rb's rewrite (which only
    // touches the .sys.mjs files) still reaches them
    const ready = ask("init", {
      runtime: "${runtimeBase(a)}main.bc.wasm.js",
      base: "resource://noraneko-builtin/${a.dir}/",
      // the deps' words, read before anything of this drop's own is
      prelude: ${JSON.stringify(preludeFiles().map((f) => f.rel))},
    });
    this.#onDestroy.push(() => worker.terminate());
    return {
      ready: ready.then(() => undefined),
      eval: async (src) => {
        await ready;
        return ask("eval", { src });
      },
      call: async (name, ...args) => {
        await ready;
        return ask("call", { name, args });
      },
      load: async (rel) => {
        await ready;
        return ask("load", { rel });
      },
    };
  }
`;
}

/**
 * The worker itself. It knows three verbs and nothing else: the host hands it
 * the URLs it needs, it brings the Tsubaki runtime up, and then answers
 * `eval` / `call` / `load` by id.
 */
function genOpsWorker(a: Actor): string {
  return `// SPDX-License-Identifier: MPL-2.0
// GENERATED by build.ts. Edit ${a.dir}/actor.ts (and its ops/*.tsubaki) instead.
//
// ${actorName(a)}'s logic, in a ChromeWorker. See tsubakiWorker() in build.ts for
// why a worker: on the main thread of the parent process, wasm cannot be
// compiled at all.

let up;
let base = "";

function bringUp(runtime) {
  // the glue finds its .wasm next to itself through document.currentScript.src;
  // a worker has no document, so it gets one with just that on it
  self.document = { currentScript: { src: runtime } };
  self.tsubakiEmbedded = true;
  const ready = new Promise((resolve) => {
    self.tsubakiOnReady = resolve;
  });
  // the jar channel says "application/wasm;charset=utf-8" and instantiateStreaming
  // wants exactly "application/wasm": read the bytes and instantiate those
  self.WebAssembly.instantiateStreaming = async (response, imports, options) =>
    WebAssembly.instantiate(await (await response).arrayBuffer(), imports, options);
  importScripts(runtime);
  return ready;
}

onmessage = async (event) => {
  const { id, op } = event.data;
  try {
    if (op === "init") {
      base = event.data.base;
      up ??= bringUp(event.data.runtime);
      await up;
      // the deps' words, in the order they were handed over
      for (const rel of event.data.prelude ?? []) {
        self.tsubakiEval(await (await fetch(base + rel)).text());
      }
      postMessage({ id, ok: true });
      return;
    }
    await up;
    switch (op) {
      case "eval":
        postMessage({ id, ok: self.tsubakiEval(event.data.src) });
        return;
      case "call":
        postMessage({ id, ok: self.tsubakiCall(event.data.name, event.data.args) });
        return;
      // a .tsubaki file of this actor (ops/<file>), run at top level
      case "load": {
        const text = await (await fetch(base + event.data.rel)).text();
        postMessage({ id, ok: self.tsubakiEval(text) });
        return;
      }
      default:
        throw new Error("unknown op " + op);
    }
  } catch (e) {
    postMessage({ id, err: String((e && e.message) || e) });
  }
};
`;
}

function genContentEntry(a: Actor): string {
  return `// SPDX-License-Identifier: MPL-2.0
// GENERATED by build.ts.
import { content, meta } from "../../${a.dir}/actor.ts";
import { runContent } from "../../_shared/contentRuntime.ts";
runContent(meta, content);
`;
}

// Re-export only `parent` so the parent bundle tree-shakes out the content hook
// (and birpc): none of that should ship in the main-process module.
function genParentEntry(a: Actor): string {
  return `// SPDX-License-Identifier: MPL-2.0
// GENERATED by build.ts.
export { parent } from "../../${a.dir}/actor.ts";
`;
}

/** What one actor's xpi contains (besides source/, which build-drop.rb adds) */
export const ACTOR_FILES = [
  "manifest.json",
  "actor.json",
  "parent.sys.mjs",
  "child.sys.mjs",
  "actor.mjs",
  "content.js",
];

function genJarMn(actors: Actor[]): string {
  const header =
    "noraneko.jar:\n% resource noraneko-builtin %nora-builtin/ contentaccessible=yes";
  const files = actors.flatMap((a) =>
    [...ACTOR_FILES, ...(wantsOps(a) ? [OPS_WORKER] : [])].map(
      (f) => `nora-builtin/${a.dir}/${f} (${a.dir}/${f})`,
    ),
  );
  files.push("nora-builtin/builtins.json (builtins.json)");
  return `${header}\n ${files.join("\n ")}\n`;
}

// xpi の JS は人が読む。build-drop.rb と同じ判定(400 字を超える行は minify と見なす)を
// ここでも走らせて、早く落ちる。
async function assertReadable(path: string): Promise<void> {
  const text = await Deno.readTextFile(path);
  const n = text.split("\n").findIndex((l) => l.length > 400);
  if (n >= 0) throw new Error(`${path}:${n + 1} looks minified (line > 400 chars). drop の JS は読める形で`);
}

async function runTsdown(config: string, actorDir: string): Promise<void> {
  const cmd = new Deno.Command("deno", {
    args: ["run", "-A", "npm:tsdown", "-c", config, `--env.MODE=${mode}`],
    cwd: ROOT,
    env: { WEBEXT_ACTOR: actorDir },
    stdout: "inherit",
    stderr: "inherit",
  });
  const { code } = await cmd.output();
  if (code !== 0) {
    throw new Error(`tsdown failed for ${config} (${actorDir})`);
  }
}

// A lib drop (drop.json lib: true): no actor. lib/index.ts is bundled to
// _dist/lib/lib.js, an IIFE that binds nora_dep_<name> in whatever scope it is
// loaded into; wasm/ is copied beside it. build-drop.rb packs _dist/lib as lib.xpi.
async function buildLib(): Promise<void> {
  const out = path.join(DIST, "lib");
  Deno.mkdirSync(out, { recursive: true });
  let hasLib = false;
  try {
    Deno.statSync(path.join(ROOT, "lib", "index.ts"));
    hasLib = true;
  } catch {
    // wasm only
  }
  if (hasLib) {
    await runTsdown("tsdown.lib.config.ts", "lib");
    await assertReadable(path.join(out, "lib.js"));
  }
  let hasWasm = false;
  try {
    Deno.statSync(path.join(ROOT, "wasm"));
    copyTree(path.join(ROOT, "wasm"), path.join(out, "wasm"));
    hasWasm = true;
  } catch {
    // no wasm
  }
  let hasOps = false;
  try {
    Deno.statSync(path.join(ROOT, "ops"));
    copyTree(path.join(ROOT, "ops"), path.join(out, "ops"));
    hasOps = true;
  } catch {
    // no ops
  }
  const manifest = {
    manifest_version: 2,
    name: DROP!.name,
    version: DROP!.version ?? "0.0.0",
    browser_specific_settings: { gecko: { id: `${DROP!.name}@noraneko.app` } },
    hidden: true,
  };
  Deno.writeTextFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  Deno.writeTextFileSync(
    path.join(out, "lib.json"),
    JSON.stringify({ name: DROP!.name, uuid: DROP!.uuid, version: DROP!.version, global: hasLib ? depGlobal(DROP!.name) : null, wasm: hasWasm, ops: hasOps, deps: DEPS }, null, 2) + "\n",
  );
  console.log(`[webext-actors] lib ${DROP!.name}: ${[hasLib ? "lib.js" : "", hasWasm ? "wasm/" : "", hasOps ? "ops/" : ""].filter(Boolean).join(" ")}`);
}

// --- main ---

if (DROP?.lib) {
  await buildLib();
  console.log("[webext-actors] build complete.");
  Deno.exit(0);
}


writeTsubakiActors();
const actorDirs = discoverActorDirs();
const actors = await Promise.all(actorDirs.map(loadActor));

await Deno.remove(DIST, { recursive: true }).catch(() => {});
await Deno.remove(GEN, { recursive: true }).catch(() => {});

const builtins = [];
for (const a of actors) {
  const outDir = path.join(DIST, a.dir);
  Deno.mkdirSync(outDir, { recursive: true });
  Deno.writeTextFileSync(path.join(outDir, "manifest.json"), genManifest(a));
  Deno.writeTextFileSync(path.join(outDir, "actor.json"), genActorJson(a));
  Deno.writeTextFileSync(path.join(outDir, "parent.sys.mjs"), genParentModule(a));
  Deno.writeTextFileSync(path.join(outDir, "child.sys.mjs"), genChildModule(a));
  if (wantsOps(a)) Deno.writeTextFileSync(path.join(outDir, OPS_WORKER), genOpsWorker(a));

  const genDir = path.join(GEN, a.dir);
  Deno.mkdirSync(genDir, { recursive: true });
  Deno.writeTextFileSync(
    path.join(genDir, "content.entry.ts"),
    genContentEntry(a),
  );
  Deno.writeTextFileSync(
    path.join(genDir, "parent.entry.ts"),
    genParentEntry(a),
  );

  builtins.push({
    id: a.meta.id,
    version: a.meta.version,
    pref: `noraneko.webext-actors.${a.dir}.enabled`,
    res_url: `resource://noraneko-builtin/${a.dir}/`,
    actor: JSON.parse(genActorJson(a)),
  });
}

Deno.writeTextFileSync(
  path.join(DIST, "builtins.json"),
  JSON.stringify(builtins, null, 2) + "\n",
);
Deno.writeTextFileSync(path.join(DIST, "jar.mn"), genJarMn(actors));
Deno.writeTextFileSync(
  path.join(DIST, "moz.build"),
  `JAR_MANIFESTS += ["jar.mn"]\n`,
);

console.log(
  `[webext-actors] generated ${actors.length} actor(s): ${actorDirs.join(", ")}`,
);

for (const a of actors) {
  await runTsdown("tsdown.actor.config.ts", a.dir);
  await runTsdown("tsdown.content.config.ts", a.dir);
  await assertReadable(path.join(DIST, a.dir, "content.js"));
  copyRuntimeFiles(a);
}

console.log("[webext-actors] build complete.");
