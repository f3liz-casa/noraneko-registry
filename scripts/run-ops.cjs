// SPDX-License-Identifier: MPL-2.0
//
//   node scripts/run-ops.cjs <tsbvm.wasm> <ops.tsb> [door [引数の JSON]]
//   node scripts/run-ops.cjs <tsbvm.wasm> <ops.tsb> --calls tests/<case>.calls
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

/** door を一つ叩く。転んだらそこで終わり */
function knock(name, args) {
  const c = tsb_call(...put(Buffer.from(name)), ...put(Buffer.from(args)));
  const answer = out();
  if (c !== 0) {
    console.error(`door ${name} で転んだ:`, answer);
    process.exit(1);
  }
  if (!answer) {
    console.error(`door ${name} が何も返さない`);
    process.exit(1);
  }
  return answer;
}

// --calls <file>: 一枚に並べた door を、**同じ VM の中で順に**叩く。
// logic は呼び出しの間で state を持っているので、別々の process では意味が変わる。
// 一行が一つ: `door [引数の JSON]`。# で始まる行と空行は読み飛ばす。
if (door === "--calls") {
  const lines = fs.readFileSync(argsJson, "utf8").split("\n");
  const chunks = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const sp = line.indexOf(" ");
    const name = sp === -1 ? line : line.slice(0, sp);
    const args = sp === -1 ? "[]" : line.slice(sp + 1).trim();
    const answer = knock(name, args);
    // 読む人のために、行で並ぶ形にする(一行の JSON は diff にならない)
    chunks.push(`--- ${name} ${args === "[]" ? "" : args}`.trimEnd());
    chunks.push(JSON.stringify(JSON.parse(answer), null, 2));
  }
  process.stdout.write(chunks.join("\n") + "\n");
} else if (door) {
  console.log(knock(door, argsJson ?? "[]"));
}
