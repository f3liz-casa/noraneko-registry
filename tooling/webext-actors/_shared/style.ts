// SPDX-License-Identifier: MPL-2.0

// style をデータで受け取って、CSS にする。
//
// **ここが、CSS の字を書く唯一の場所。** drop は一度も CSS を綴らない -- 綴らない
// から、「外に電話できない」を走査で守らなくていい。**印字できるものしか印字しない**、
// それだけで守られる(`url(...)` の書きかたが、そもそも無い)。
//
//     Dict(:width => 40px, :gap => 2px)              → 要素の style 属性
//     Dict(:width => 40px, ":hover" => Dict(...))    → class 一つと、規則一つ
//
// 読みかた:
//
//   鍵が名前          property。`_` は `-`(頭の `_` は `-moz-` などの頭の `-`)
//   鍵が selector     入れ子。`:` `[` `>` `+` `~` `&` 空白 `@` で始まるもの
//   数                px。単位を持たない property(下の UNITLESS)だけ素の数
//   Len(40, :px)      `40px`。`:pct` は `%`
//   文字列 / Symbol   そのまま(Symbol は JSON を渡るとき文字列になる。同じもの)
//   並び              空白で連ねる(`(1px, :solid, Theme.separator)`)。読点が要る
//                     ものは、文字列で書く("Arial, sans-serif")
//
// 入れ子が無ければ style 属性に置く(sheet が育たない)。有れば**中身から class の
// 名前を作って**、規則を一枚の <style> に足す。同じ style は同じ class になるので、
// 状態で描き替えても増えない。

/** 一枚ぶんの style。値は数 / Len / 文字列 / 並び / 入れ子 */
export type StyleData = Record<string, unknown>;

export function isStyleData(v: unknown): v is StyleData {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 素の数で書く property(px を足さない) */
const UNITLESS = new Set([
  "opacity", "order", "z-index", "flex", "flex-grow", "flex-shrink", "line-height",
  "font-weight", "zoom", "column-count", "columns", "orphans", "widows", "tab-size",
  "aspect-ratio", "scale", "animation-iteration-count", "grid-row", "grid-column",
  "grid-row-start", "grid-row-end", "grid-column-start", "grid-column-end",
  "fill-opacity", "stroke-opacity", "stroke-width", "stroke-dashoffset", "stroke-miterlimit",
]);

/** 長さの単位。知らない単位は印字しない */
const UNITS: Record<string, string> = {
  px: "px", pct: "%", em: "em", rem: "rem", ch: "ch", ex: "ex",
  vh: "vh", vw: "vw", vmin: "vmin", vmax: "vmax", fr: "fr",
  s: "s", ms: "ms", deg: "deg", turn: "turn",
};

/** 値の中に書けない字。閉じ括弧や `;` は、一つの宣言から外へ出る道になる */
const NOT_IN_VALUE = /[;{}<>\\]|url\s*\(|image-set\s*\(|\/\*|expression\s*\(/i;
/** selector に書けない字。`{` `}` `;` と、@import(外を読みに行く) */
const NOT_IN_SELECTOR = /[{};]|\/\*|@import/i;

const SELECTOR_HEAD = /^[:\[>+~&\s@]/;

function warn(what: string, ...rest: unknown[]): void {
  console.warn(`[style] ${what}`, ...rest);
}

/** 鍵 → property の名前。`min_width` → `min-width`、`_moz_x` → `-moz-x` */
function propertyName(key: string): string | null {
  const name = key.replace(/_/g, "-");
  if (!/^-{0,2}[a-zA-Z][a-zA-Z0-9-]*$/.test(name)) {
    warn("property の名前として読めない:", key);
    return null;
  }
  return name;
}

/** 一つの値 → CSS の字。印字できないものは null(そのまま落とす) */
function valueText(property: string, v: unknown): string | null {
  if (v === null || v === undefined || typeof v === "boolean") return null;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    return UNITLESS.has(property) ? String(v) : `${v}px`;
  }
  if (typeof v === "string") {
    if (NOT_IN_VALUE.test(v)) {
      warn("値に書けない字がある(url( や ; など):", property, v);
      return null;
    }
    return v;
  }
  if (Array.isArray(v)) {
    const parts = v.map((one) => valueText(property, one));
    if (parts.some((p) => p === null)) return null;
    return parts.join(" ");
  }
  if (isStyleData(v) && v.__type === "Len") {
    const unit = UNITS[String(v.unit)];
    if (unit === undefined) {
      warn("知らない単位:", v.unit);
      return null;
    }
    const n = v.n;
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
    return `${n}${unit}`;
  }
  warn("印字できない値:", property, v);
  return null;
}

/** この鍵は「入れ子の selector」か */
function isSelector(key: string): boolean {
  return SELECTOR_HEAD.test(key);
}

/** 入れ子を持つか(持てば class、持たなければ style 属性) */
export function isNested(data: StyleData): boolean {
  return Object.keys(data).some(isSelector);
}

/** 平らな宣言だけ → `width: 40px; gap: 2px` */
export function declarations(data: StyleData): string {
  const out: string[] = [];
  for (const key of Object.keys(data)) {
    if (key === "__type" || isSelector(key)) continue;
    const property = propertyName(key);
    if (!property) continue;
    const text = valueText(property, data[key]);
    if (text === null) continue;
    out.push(`${property}: ${text}`);
  }
  return out.join("; ");
}

/** 一枚の規則(入れ子は CSS nesting でそのまま出す) */
export function rule(selector: string, data: StyleData): string {
  if (NOT_IN_SELECTOR.test(selector)) {
    warn("selector に書けない字がある:", selector);
    return "";
  }
  const body: string[] = [];
  const decls = declarations(data);
  if (decls) body.push(`  ${decls};`);
  for (const key of Object.keys(data)) {
    if (!isSelector(key)) continue;
    const inner = data[key];
    if (!isStyleData(inner)) {
      warn("入れ子の中身が style ではない:", key);
      continue;
    }
    const nested = rule(key.startsWith("@") ? key : `&${key.trimStart() === key ? "" : " "}${key.trim()}`, inner);
    if (nested) body.push(nested.split("\n").map((l) => `  ${l}`).join("\n"));
  }
  if (body.length === 0) return "";
  return `${selector} {\n${body.join("\n")}\n}`;
}

/** 中身から名前を作る(同じ style は同じ class)。FNV-1a */
export function classOf(data: StyleData): string {
  const text = canonical(data);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `nora-${h.toString(36)}`;
}

/** 鍵の並びで答えが変わらないように、並べてから字にする */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (isStyleData(v)) {
    return `{${Object.keys(v).sort().map((k) => `${k}:${canonical(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/** 規則を置いていく先。同じ class は一度だけ書く */
export interface Sheet {
  /** その style の class 名(規則はまだ無ければ、ここで足される) */
  classFor(data: StyleData): string;
}

export function makeSheet(add: (css: string) => void): Sheet {
  const seen = new Set<string>();
  return {
    classFor(data) {
      const name = classOf(data);
      if (!seen.has(name)) {
        seen.add(name);
        const css = rule(`.${name}`, data);
        if (css) add(css);
      }
      return name;
    },
  };
}

/** props の style を、要素に渡せる形にする */
export function printStyle(
  data: StyleData,
  sheet: Sheet | undefined,
): { style?: string; class?: string } {
  if (!isNested(data)) {
    const decls = declarations(data);
    return decls ? { style: decls } : {};
  }
  if (!sheet) {
    // 入れ子は class が要る。置き場所が無いときは、平らなところだけでも出す
    warn("入れ子のある style を置く先が無い(平らなところだけ置く)");
    const decls = declarations(data);
    return decls ? { style: decls } : {};
  }
  return { class: sheet.classFor(data) };
}
