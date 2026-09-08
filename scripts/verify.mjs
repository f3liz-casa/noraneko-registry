// sigstore の bundle(keyless)を、公式の @sigstore/verify で確かめる。
//
//   node scripts/verify.mjs <bundle.sigstore.json> <artifact> <identity> [issuer]
//
// trusted root は repo の trusted_root.json(sigstore/root-signing の targets/trusted_root.json を pin)。
// 通れば JSON を一行出して exit 0、落ちれば reason を出して exit 1。
// ブラウザの中の verifier(noraneko の modules/sigstore)は Rekor v1 だけなので、v2 / TSA / SCT はここが本番。
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { bundleFromJSON } from "@sigstore/bundle";
import { TrustedRoot } from "@sigstore/protobuf-specs";
import { Verifier, toTrustMaterial, toSignedEntity } from "@sigstore/verify";

const [bundlePath, artifactPath, identity, issuer = "https://token.actions.githubusercontent.com"] = process.argv.slice(2);
if (!bundlePath || !artifactPath || !identity) {
  console.error("usage: verify.mjs <bundle.sigstore.json> <artifact> <identity> [issuer]");
  process.exit(2);
}
const rootPath = fileURLToPath(new URL("../trusted_root.json", import.meta.url));
const root = TrustedRoot.fromJSON(JSON.parse(await readFile(rootPath, "utf8")));
const bundleJson = JSON.parse(await readFile(bundlePath, "utf8"));
const bundle = bundleFromJSON(bundleJson);
const artifact = await readFile(artifactPath);

try {
  const verifier = new Verifier(toTrustMaterial(root), { ctlogThreshold: 1, tlogThreshold: 1 });
  const result = verifier.verify(toSignedEntity(bundle, artifact), {
    subjectAlternativeName: identity,
    extensions: { issuer },
  });
  const tlog = bundleJson.verificationMaterial?.tlogEntries?.[0];
  console.log(JSON.stringify({
    ok: true,
    identity: result.signer?.identity?.subjectAlternativeName ?? identity,
    issuer,
    logIndex: tlog?.logIndex ?? null,
    logId: tlog?.logId?.keyId ?? null,
    integratedTime: tlog?.integratedTime ? new Date(Number(tlog.integratedTime) * 1000).toISOString() : null,
    rekor: tlog?.logIndex ? `https://search.sigstore.dev/?logIndex=${tlog.logIndex}` : null,
  }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, reason: String(e?.message ?? e) }));
  process.exit(1);
}
