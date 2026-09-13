// SPDX-License-Identifier: MPL-2.0
//
//   node scripts/run-ops.cjs <tsbvm.wasm> <ops.tsb> [door [引数の JSON]]
//
// **配る wasm そのもの**で、drop の畳んだ logic を起こして door を叩く。
// browser を建てずに「この runtime で、この drop が本当に動くか」が分かる
// いちばん短い道 -- runtime を差し替えたときに、いちばん効く。
//
// build.rb が Tsubaki の drop を組んだあとに setup() を一度叩く。
// 手で見るときは door と引数を足す:
//
//   node scripts/run-ops.cjs drops/std-tsubaki-runtime/src/wasm/tsbvm.wasm \
//     _stage/webpanel/_dist/webpanel/ops.tsb start '[{"prefs":{},"url":""}]'
//
// 段 2 の `drop test`(golden と、宣言との突き合わせ)は、この上に乗る。

const fs = require("fs");

const [wasmPath, tsbPath, door, argsJson] = process.argv.slice(2);
if (!wasmPath || !tsbPath) {
  console.error("usage: run-ops.cjs <tsbvm.wasm> <ops.tsb> [door [引数の JSON]]");
  process.exit(2);
}

let inst;
try {
  inst = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(wasmPath)), {});
} catch (e) {
  console.error("runtime が読めない:", String(e && e.message || e));
  process.exit(1);
}
const { tsb_alloc, tsb_run, tsb_call, tsb_out_ptr, tsb_out_len, memory } = inst.exports;
for (const [name, fn] of Object.entries({ tsb_alloc, tsb_run, tsb_call, tsb_out_ptr, tsb_out_len })) {
  if (typeof fn !== "function") {
    console.error(`runtime に ${name} が無い(この wasm は tsbvm ではない?)`);
    process.exit(1);
  }
}

/** バイトを module のメモリに置いて、その場所と長さを返す(参照は越えない) */
const put = (b) => {
  const p = tsb_alloc(b.length);
  new Uint8Array(memory.buffer, p, b.length).set(b);
  return [p, b.length];
};
const out = () =>
  Buffer.from(new Uint8Array(memory.buffer, tsb_out_ptr(), tsb_out_len())).toString("utf8");

const code = tsb_run(...put(fs.readFileSync(tsbPath)));
const printed = out();
if (code !== 0) {
  console.error("走らせるところで転んだ(code " + code + "):", printed);
  process.exit(1);
}
if (printed) process.stdout.write(printed);

if (door) {
  const c = tsb_call(...put(Buffer.from(door)), ...put(Buffer.from(argsJson ?? "[]")));
  const answer = out();
  if (c !== 0) {
    console.error(`door ${door} で転んだ:`, answer);
    process.exit(1);
  }
  if (!answer) {
    console.error(`door ${door} が何も返さない`);
    process.exit(1);
  }
  console.log(answer);
}
