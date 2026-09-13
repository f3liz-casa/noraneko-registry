// SPDX-License-Identifier: MPL-2.0
// 試験のときの std。本物は preact も pref も連れてくるけれど、_shared の試験が
// 要るのは h と Fragment だけなので、ここで小さく差し替える(deno.test.json)。
export const Fragment = Symbol("Fragment");
// deno-lint-ignore no-explicit-any
export const h = (tag: any, props: any, kids: any) => ({ tag, props, kids });
