// GENERATED ops-worker.js を、node の中で一度通してみる道具。
//
//     node scripts/worker-smoke.cjs _dist/<actor> <tsbvm.wasm> <sheet.tsb>... [関数名]
//
// .tsb は読む順に並べる -- deps の言葉(std)が先、drop 自身のがあと。
//
// worker のまわり(fetch と postMessage と onmessage)だけを偽装して、init と
// call を本当に走らせる。実機で初めて転ぶのを避けるための、一歩手前の検算です
// -- ChromeWorker そのものは、ここでは試せない(wasm の compile が通るかは
// 別の話。それは前から通っている)。
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const dist = process.argv[2];
const wasm = process.argv[3];
const rest = process.argv.slice(4);
const sheets = [];
for (const a of rest) {
  if (!a.endsWith(".tsb")) break;
  sheets.push(a);
}
const fname = rest[sheets.length];
if (!dist || !wasm || sheets.length === 0) {
  console.error("usage: worker-smoke.cjs _dist/<actor> <tsbvm.wasm> <sheet.tsb>... [function]");
  process.exit(1);
}

// resource:// は無いので、渡したパスをそのまま読む(.wasm だけは別に指す)
globalThis.fetch = async (url) => {
  const file = url.endsWith(".wasm") ? wasm : url;
  const b = fs.readFileSync(file);
  return { arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
};

const answers = new Map();
globalThis.postMessage = (m) => answers.set(m.id, m);
globalThis.self = globalThis;

const src = fs.readFileSync(path.join(dist, "ops-worker.js"), "utf8");
vm.runInThisContext(src, { filename: "ops-worker.js" });

async function ask(id, data) {
  await globalThis.onmessage({ data: { id, ...data } });
  const a = answers.get(id);
  if (!a) throw new Error(`no answer for ${data.op}`);
  if (a.err !== undefined) throw new Error(a.err);
  return a.ok;
}

(async () => {
  await ask(1, {
    op: "init",
    runtime: "resource://std/wasm/tsbvm.wasm",
    sheets,
  });
  console.log("init: ok");
  if (fname) console.log(`${fname}:`, JSON.stringify(await ask(2, { op: "call", name: fname, args: [] })));
})().catch((e) => {
  console.error("worker-smoke:", e.message);
  process.exit(1);
});
