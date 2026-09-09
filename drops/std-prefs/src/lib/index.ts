// SPDX-License-Identifier: MPL-2.0

// std-prefs: one about:config pref per setting, from one schema.
//
// Firefox keeps each setting in its own pref, and that is the shape a browser's
// settings want to have: a user can override one of them in user.js, another
// mod can force one of them, and adding a new setting adds a new pref instead
// of rewriting a value that already holds everyone's answers. What grouping
// them into a single JSON pref buys -- one file that lists every setting, with
// its type and default, and completion while you write -- is bought here by the
// schema instead:
//
//   export const prefs = definePrefs("noraneko.webpanel", {
//     globalWidth: pref.int(400),
//     positionStart: pref.bool(false),
//     tabs: { style: pref.choice(["proton", "photon"], "proton") },
//   });
//
//   prefs.globalWidth.value          // read (tracked, so computed() sees it)
//   prefs.globalWidth.set(420)       // write -- this goes to about:config
//   prefs.tabs.style.value           // "proton" | "photon", spelled out by the schema
//   useSignalValue(prefs.tabs.style.signal)   // a view that follows it
//
// The leaf key is the rest of the pref name, so the schema above is
// noraneko.webpanel.globalWidth, .positionStart and .tabs.style. Defaults go on
// the default branch, which is what makes about:config show the setting, "Reset"
// put it back, and a user.js line win.
//
// Reading works anywhere. Writing is the parent process's job, so a content
// actor (about:newtab and friends) asks its parent instead of calling set().

import { signal, type ReadonlySignal } from "std-preact-xul";

/** The default branch: where a default value lives, so a user value can be told apart from it. */
type DefaultBranch = ReturnType<typeof Services.prefs.getDefaultBranch>;

/**
 * What one setting is: how to read it, how to write it, what it falls back to.
 * `pref.bool` and friends make these; a schema is a tree of them.
 */
export interface PrefSpec<T> {
  readonly __pref: true;
  readonly def: T;
  read(name: string): T;
  write(name: string, v: T): void;
  putDefault(branch: DefaultBranch, name: string): void;
  /** Whether a fresh read is the same value (json reads allocate, so Object.is is not enough). */
  eq(a: T, b: T): boolean;
  /** A value from somewhere else (an old grouped pref), if it is one of ours. */
  coerce(v: unknown): T | undefined;
}

/** One setting, once the schema knows its name. */
export interface Pref<T> {
  /** The whole pref name, as about:config spells it. */
  readonly name: string;
  /** The value now. Reading this inside computed()/effect() is tracked. */
  readonly value: T;
  /** The same value as a signal, for `useSignalValue` in a view. */
  readonly signal: ReadonlySignal<T>;
  /** false while the pref still holds its default. */
  readonly hasUserValue: boolean;
  /** Write it. No need to read it first. */
  set(v: T): void;
  /** Back to the default (about:config's "Reset"). */
  reset(): void;
}

// A schema is specs, or more schema. (PrefSpec<any>: a spec is written into the
// schema and read back out as its own type; the tree itself holds all of them.)
export type PrefShape = { [key: string]: PrefSpec<any> | PrefShape };

export type Prefs<S> = {
  [K in keyof S]: S[K] extends PrefSpec<infer T> ? Pref<T> : Prefs<S[K]>;
};

/** The kinds of setting. about:config holds bool, int and string; json rides on a string. */
export const pref = {
  bool(def: boolean): PrefSpec<boolean> {
    return {
      __pref: true,
      def,
      eq: Object.is,
      read: (name) => tryRead(() => Services.prefs.getBoolPref(name, def), def),
      write: (name, v) => Services.prefs.setBoolPref(name, v),
      putDefault: (branch, name) => branch.setBoolPref(name, def),
      coerce: (v) => (typeof v === "boolean" ? v : undefined),
    };
  },

  int(def: number): PrefSpec<number> {
    return {
      __pref: true,
      def,
      eq: Object.is,
      read: (name) => tryRead(() => Services.prefs.getIntPref(name, def), def),
      write: (name, v) => Services.prefs.setIntPref(name, v),
      putDefault: (branch, name) => branch.setIntPref(name, def),
      coerce: (v) => (typeof v === "number" && Number.isInteger(v) ? v : undefined),
    };
  },

  string(def: string): PrefSpec<string> {
    return {
      __pref: true,
      def,
      eq: Object.is,
      read: (name) => tryRead(() => Services.prefs.getStringPref(name, def), def),
      write: (name, v) => Services.prefs.setStringPref(name, v),
      putDefault: (branch, name) => branch.setStringPref(name, def),
      coerce: (v) => (typeof v === "string" ? v : undefined),
    };
  },

  /**
   * One of a few names. A string, never a number: numbers shift when a choice is
   * added or taken away, and then everyone's setting means something else.
   */
  choice<const O extends readonly string[]>(options: O, def: O[number]): PrefSpec<O[number]> {
    const known = (v: unknown): v is O[number] => typeof v === "string" && (options as readonly string[]).includes(v);
    return {
      __pref: true,
      def,
      eq: Object.is,
      read: (name) => {
        const v = tryRead(() => Services.prefs.getStringPref(name, def), def);
        return known(v) ? v : def;
      },
      write: (name, v) => Services.prefs.setStringPref(name, v),
      putDefault: (branch, name) => branch.setStringPref(name, def),
      coerce: (v) => (known(v) ? v : undefined),
    };
  },

  /**
   * The way out, for what does not split: a list, or something whose shape is the
   * user's (a panel list, a list of registries). Saying `pref.json` here is saying
   * "this one is data, not settings" -- a setting belongs in its own pref.
   */
  json<T>(def: T): PrefSpec<T> {
    const parse = (text: string): T => {
      try {
        return text === "" ? def : (JSON.parse(text) as T);
      } catch {
        return def;
      }
    };
    return {
      __pref: true,
      def,
      eq: (a, b) => JSON.stringify(a) === JSON.stringify(b),
      read: (name) => parse(tryRead(() => Services.prefs.getStringPref(name, ""), "")),
      write: (name, v) => Services.prefs.setStringPref(name, JSON.stringify(v)),
      putDefault: (branch, name) => branch.setStringPref(name, JSON.stringify(def)),
      // adoptPref never takes a value over into a json pref: nothing here knows
      // what shape it should be, and a wrong shape is worse than an empty one.
      // A drop that wants to bring a list over looks at it itself, then set()s.
      coerce: () => undefined,
    };
  },
};

/**
 * Give a schema its root, and get the tree of settings back.
 *
 * Every default is put on the default branch here, so from this moment
 * about:config shows the setting even if nobody has ever changed it.
 *
 * Call it where the window is -- inside the content hook -- and keep the schema
 * itself in `data/`. Nothing under a module's top level may touch the browser:
 * the build imports the actor tree to read its meta, and there is no
 * about:config there (docs/TRAPS.md).
 */
export function definePrefs<S extends PrefShape>(root: string, shape: S): Prefs<S> {
  const branch = Services.prefs.getDefaultBranch("");
  const leaves = new Map<string, () => void>();

  const build = (level: PrefShape, path: string): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(level)) {
      const name = `${path}.${key}`;
      out[key] = isSpec(value) ? makeLeaf(value, name, branch, leaves) : build(value, name);
    }
    return out;
  };

  const tree = build(shape, root);
  Object.defineProperty(tree, REGISTRY, { value: { root, leaves } satisfies Registry });
  return tree as Prefs<S>;
}

/**
 * Follow about:config: when one of these prefs is changed anywhere -- another
 * window, user.js on the next start, a person typing in about:config -- the
 * signal changes too. The watching stops when the drop goes (ctx.io).
 *
 * Only for changes from outside; `set()` moves its own signal. Once per window.
 */
export function watchPrefs(io: IoPrefLike, prefs: object): void {
  for (const [name, refresh] of registryOf(prefs).leaves) io.pref(name, refresh);
}

/**
 * Take a value over from an older grouped pref, once: the JSON at `group`, its
 * `key`, into this setting -- but only while nobody has answered it here yet, and
 * only if what is there is of the right kind. The old pref is left alone.
 * (Not for `pref.json`: see there.)
 *
 *   adoptPref(prefs.globalWidth, "floorp.panelSidebar.config", "globalWidth");
 *
 * Returns whether anything was taken over.
 */
export function adoptPref<T>(leaf: Pref<T>, group: string, key: string): boolean {
  if (leaf.hasUserValue) return false;
  const spec = SPEC.get(leaf);
  if (!spec) throw new Error("adoptPref: definePrefs() の leaf ではない");
  let held: unknown;
  try {
    held = JSON.parse(Services.prefs.getStringPref(group, ""));
  } catch {
    return false; // 無い、あるいは JSON ではない
  }
  if (typeof held !== "object" || held === null) return false;
  const value = spec.coerce((held as Record<string, unknown>)[key]);
  if (value === undefined) return false;
  leaf.set(value);
  console.log(`[std-prefs] ${leaf.name} ← ${group}.${key}`);
  return true;
}

/** The shape of ctx.io that watchPrefs needs (the drop tooling's _shared/io.ts). */
export interface IoPrefLike {
  pref(name: string, fn: () => void): void;
}

// --- inside ------------------------------------------------------------------

const REGISTRY = Symbol("std-prefs");
const SPEC = new WeakMap<object, PrefSpec<any>>();

interface Registry {
  root: string;
  /** pref name -> read it again and move the signal if it moved */
  leaves: Map<string, () => void>;
}

/** A pref whose type in about:config is not the one the schema asks for throws; the default stands. */
function tryRead<T>(read: () => T, def: T): T {
  try {
    return read();
  } catch {
    return def;
  }
}

function isSpec(value: PrefSpec<any> | PrefShape): value is PrefSpec<any> {
  return (value as PrefSpec<any>).__pref === true;
}

function makeLeaf<T>(
  spec: PrefSpec<T>,
  name: string,
  branch: DefaultBranch,
  leaves: Map<string, () => void>,
): Pref<T> {
  spec.putDefault(branch, name);
  const held = signal(spec.read(name));
  const refresh = () => {
    const next = spec.read(name);
    if (!spec.eq(next, held.peek())) held.value = next;
  };
  leaves.set(name, refresh);

  const leaf: Pref<T> = {
    name,
    get value() {
      return held.value;
    },
    signal: held,
    get hasUserValue() {
      return Services.prefs.prefHasUserValue(name);
    },
    set(v) {
      spec.write(name, v);
      refresh();
    },
    reset() {
      Services.prefs.clearUserPref(name);
      refresh();
    },
  };
  SPEC.set(leaf, spec);
  return leaf;
}

function registryOf(prefs: object): Registry {
  const registry = (prefs as Record<symbol, Registry | undefined>)[REGISTRY];
  if (!registry) throw new Error("watchPrefs: definePrefs() のものではない");
  return registry;
}
