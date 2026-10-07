import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseAttestationArguments, validateReleaseOptions, verifyPublishedRelease } from "./lib/release-verification.mjs";

const options = { repo: "example/project", version: "1.2.3", commit: "a".repeat(40), tree: "b".repeat(40), ciRun: "12", publishRun: "13" };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function fixture() {
  const tar = Buffer.from("synthetic-package");
  const sbom = Buffer.from(JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.6", metadata: { component: { version: options.version } } }));
  const sums = Buffer.from(`${hash(tar)}  ./cairnkeep-cli-1.2.3.tgz\n${hash(sbom)}  ./cairnkeep-cli-1.2.3.cdx.json\n`);
  const candidate = new Map([["cairnkeep-cli-1.2.3.tgz", tar], ["cairnkeep-cli-1.2.3.cdx.json", sbom], ["SHA256SUMS", sums],
    ["RELEASE-CANDIDATE.json", Buffer.from(JSON.stringify({ schema_version: 1, tree: options.tree, version: options.version }))]]);
  const released = new Map([...candidate].filter(([name]) => name !== "RELEASE-CANDIDATE.json"));
  const api = new Map([
    ["actions/runs/12", { conclusion: "success", path: ".github/workflows/ci.yml", head_sha: options.commit }],
    ["actions/runs/13", { conclusion: "success", path: ".github/workflows/publish.yml", head_sha: options.commit, event: "release" }],
    [`git/commits/${options.commit}`, { tree: { sha: options.tree } }],
    ["git/ref/tags/v1.2.3", { object: { type: "commit", sha: options.commit } }],
    ["actions/runs/12/artifacts?per_page=100", { artifacts: [{ id: 5, name: `release-candidate-${options.tree}`, expired: false }] }],
    ["releases/tags/v1.2.3", { draft: false, prerelease: false, tag_name: "v1.2.3" }],
  ]);
  const objects = new Map();
  const add = value => { const digest = `sha256:${hash(Buffer.from(JSON.stringify(value)))}`; objects.set(digest, value); return digest; };
  const manifests = [];
  for (const architecture of ["amd64", "arm64"]) {
    const config = add({ os: "linux", architecture, config: { Labels: { "org.opencontainers.image.revision": options.commit } } });
    const image = add({ config: { digest: config } });
    manifests.push({ digest: image, platform: { os: "linux", architecture } });
    const statement = add({ predicateType: "https://spdx.dev/Document", subject: [{ digest: { sha256: image.slice(7) } }], predicate: { spdxVersion: "SPDX-2.3" } });
    const attestation = add({ layers: [{ digest: statement }] });
    manifests.push({ digest: attestation, annotations: { "vnd.docker.reference.digest": image, "vnd.docker.reference.type": "attestation-manifest" } });
  }
  const index = add({ manifests });
  let signed = 0, signatures = 0;
  const io = {
    api: async path => { assert(api.has(path), `unexpected API request ${path}`); return api.get(path); },
    candidate: async () => candidate, release: async () => released,
    registry: async () => ({ version: options.version, dist: { tarball: "https://registry.npmjs.org/package.tgz", integrity: `sha512-${createHash("sha512").update(tar).digest("base64")}` } }),
    tarball: async () => tar,
    oci: async (_image, _kind, ref) => { const digest = ref.startsWith("sha256:") ? ref : index; return { digest, value: objects.get(digest) }; },
    verifyAttestation: async (_image, digest, expected) => { assert.equal(digest, index); assert.deepEqual(expected, options); signed++; return true; },
    verifyNpm: async bytes => { assert(bytes.equals(tar)); signatures++; return true; },
  };
  return { io, api, candidate, released, objects, manifests, index, counts: () => ({ signed, signatures }) };
}
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error("offline release controls must not use the network"); };
try {
  for (const invalid of [{ repo: "../.." }, { repo: "owner/../secret" }, { version: "01.2.3" }, { version: "1.2.3-beta" },
    { commit: "main" }, { ciRun: "0" }, { publishRun: "not-a-run" }]) {
    assert.throws(() => validateReleaseOptions({ ...options, ...invalid }));
  }
  const attestationArgs = releaseAttestationArguments("example/project", `sha256:${"d".repeat(64)}`, options);
  for (const [flag, value] of [["--source-digest", options.commit], ["--source-ref", "refs/tags/v1.2.3"],
    ["--cert-identity", "https://github.com/example/project/.github/workflows/publish.yml@refs/tags/v1.2.3"],
    ["--cert-oidc-issuer", "https://token.actions.githubusercontent.com"], ["--predicate-type", "https://slsa.dev/provenance/v1"]]) {
    assert.equal(attestationArgs[attestationArgs.indexOf(flag) + 1], value);
  }
  assert(attestationArgs.includes("--deny-self-hosted-runners"));
  assert(!attestationArgs.includes("--signer-workflow"), "mutually exclusive identity flags cannot be combined");
  assert.throws(() => releaseAttestationArguments("other/project", `sha256:${"d".repeat(64)}`, options));
  const valid = fixture();
  const report = await verifyPublishedRelease(options, valid.io);
  assert.equal(report.status, "verified"); assert.equal(report.images.length, 2);
  assert.equal(report.deployment_verified, false); assert.equal(report.full_image_layer_pull_verified, false);
  assert.deepEqual(valid.counts(), { signed: 2, signatures: 1 });
  for (const [name, mutate] of [
    ["failed CI", f => { f.api.get("actions/runs/12").conclusion = "failure"; }],
    ["wrong CI workflow", f => { f.api.get("actions/runs/12").path = ".github/workflows/other.yml"; }],
    ["different tree", f => { f.api.get(`git/commits/${options.commit}`).tree.sha = "c".repeat(40); }],
    ["different tag", f => { f.api.get("git/ref/tags/v1.2.3").object.sha = "c".repeat(40); }],
    ["expired candidate", f => { f.api.get("actions/runs/12/artifacts?per_page=100").artifacts[0].expired = true; }],
    ["failed publication", f => { f.api.get("actions/runs/13").conclusion = "failure"; }],
    ["wrong publish source", f => { f.api.get("actions/runs/13").head_sha = "c".repeat(40); }],
    ["draft release", f => { f.api.get("releases/tags/v1.2.3").draft = true; }],
    ["candidate tampering", f => { f.candidate.set("cairnkeep-cli-1.2.3.tgz", Buffer.from("tampered")); }],
    ["asset tampering", f => { f.released.set("cairnkeep-cli-1.2.3.cdx.json", Buffer.from("tampered")); }],
    ["undeclared candidate", f => { f.candidate.set("extra", Buffer.from("extra")); }],
    ["checksum traversal", f => { f.candidate.set("SHA256SUMS", Buffer.from(`${"a".repeat(64)}  ../escape\n`)); }],
    ["registry mismatch", f => { f.io.tarball = async () => Buffer.from("different"); }],
    ["registry credentials", f => { f.io.registry = async () => ({ version: "1.2.3", dist: { tarball: "https://secret@registry.npmjs.org/package.tgz" } }); }],
    ["signature failure", f => { f.io.verifyNpm = async () => false; }],
    ["missing architecture", f => { f.objects.get(f.index).manifests = f.manifests.filter(m => m.platform?.architecture !== "arm64"); }],
    ["wrong image revision", f => { for (const value of f.objects.values()) if (value.config?.Labels) value.config.Labels["org.opencontainers.image.revision"] = "c".repeat(40); }],
    ["unbound SBOM", f => { for (const value of f.objects.values()) if (value.subject) value.subject[0].digest.sha256 = "c".repeat(64); }],
    ["provenance failure", f => { f.io.verifyAttestation = async () => false; }],
  ]) { const f = fixture(); mutate(f); await assert.rejects(() => verifyPublishedRelease(options, f.io), undefined, name); }
  const scratch = mkdtempSync(join(tmpdir(), "cairn-release-report-test-"));
  try {
    const output = join(scratch, "existing.json"); writeFileSync(output, "retained-report\n");
    const command = fileURLToPath(new URL("verify-published-release.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [command, "--version", options.version, "--commit", options.commit,
      "--tree", options.tree, "--ci-run", options.ciRun, "--publish-run", options.publishRun,
      "--out", output, "--gh", join(scratch, "missing-command")], { encoding: "utf8", timeout: 3000 });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /output already exists/);
    assert.equal(readFileSync(output, "utf8"), "retained-report\n");
    assert.equal(result.stdout, "");
  } finally { rmSync(scratch, { recursive: true, force: true }); }
  console.log("PASS: offline exact-tree release, assets, registry, signatures, architectures, SBOM and provenance controls");
} finally { globalThis.fetch = originalFetch; }
