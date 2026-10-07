#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readStableFile } from "./lib/stable-file.mjs";
import { releaseAttestationArguments, validateReleaseOptions, verifyPublishedRelease } from "./lib/release-verification.mjs";

const usage = "Usage: node scripts/verify-published-release.mjs --version X.Y.Z --commit SHA --tree SHA --ci-run ID --publish-run ID --out FILE [--repo OWNER/REPO] [--gh PATH] [--npm PATH]";
function optionsFrom(args) {
  const options = { repo: "cairnkeep/cairnkeep", gh: "gh", npm: "npm" };
  const keys = new Map([["--version", "version"], ["--commit", "commit"], ["--tree", "tree"], ["--ci-run", "ciRun"],
    ["--publish-run", "publishRun"], ["--repo", "repo"], ["--gh", "gh"], ["--npm", "npm"], ["--out", "out"]]);
  const seen = new Set();
  for (let i = 0; i < args.length; i += 2) {
    const key = keys.get(args[i]);
    if (!key || seen.has(key) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error(usage);
    seen.add(key); options[key] = args[i + 1];
  }
  if (!options.out) throw new Error(usage);
  validateReleaseOptions(options);
  return options;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) {
    const operation = ["api", "run", "release", "install", "audit", "attestation"].includes(args[0]) ? args[0] : "required";
    throw new Error(`Release verification failed: ${operation} command unavailable, timed out or failed.`);
  }
  return result.stdout;
}

async function bytesFrom(url, maxBytes, headers = {}, blobRedirects = false) {
  const signal = AbortSignal.timeout(30000);
  let response;
  for (let redirects = 0; redirects <= 3; redirects++) {
    response = await fetch(url, { headers, redirect: "manual", signal });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const next = new URL(response.headers.get("location"), url);
    await response.body?.cancel();
    if (!blobRedirects || redirects === 3 || next.protocol !== "https:"
      || next.hostname !== "pkg-containers.githubusercontent.com" || next.username || next.password || next.port) {
      throw new Error("Release verification failed: unexpected registry redirect.");
    }
    url = next.href; headers = {}; // Never forward registry authorization.
  }
  if (!response.ok || !response.body) throw new Error("Release verification failed: remote response unavailable.");
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) { await response.body.cancel(); throw new Error("Release verification failed: remote byte limit."); }
  const reader = response.body.getReader();
  const chunks = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("Release verification failed: remote byte limit.");
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
const parse = bytes => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
const digest = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

async function main(args) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) { console.log(usage); return; }
  const options = optionsFrom(args);
  const { gh, npm, out, ...expected } = options;
  const output = resolve(out);
  try { fs.lstatSync(output); throw new Error("Release verification failed: output already exists."); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const scratch = fs.mkdtempSync(join(tmpdir(), "cairn-release-verification-"));
  fs.chmodSync(scratch, 0o700);
  const ghRun = args => run(gh, args);
  const readDirectory = directory => new Map(fs.readdirSync(directory).map(name => [name,
    readStableFile(join(directory, name), { label: "Release verification input", maxBytes: 64 * 1024 * 1024 }).bytes]));
  const tokens = new Map();
  try {
    const io = {
      api: async suffix => JSON.parse(ghRun(["api", `repos/${expected.repo}/${suffix}`])),
      candidate: async artifact => {
        const directory = join(scratch, "candidate");
        ghRun(["run", "download", expected.ciRun, "--repo", expected.repo, "--name", artifact.name, "--dir", directory]);
        return readDirectory(directory);
      },
      release: async () => {
        const directory = join(scratch, "release");
        ghRun(["release", "download", `v${expected.version}`, "--repo", expected.repo, "--dir", directory]);
        return readDirectory(directory);
      },
      registry: async () => parse(await bytesFrom(`https://registry.npmjs.org/@cairnkeep%2fcli/${expected.version}`, 8 * 1024 * 1024)),
      tarball: async url => bytesFrom(url, 64 * 1024 * 1024),
      verifyNpm: async tarball => {
        const prefix = join(scratch, "npm");
        run(npm, ["install", "--prefix", prefix, `@cairnkeep/cli@${expected.version}`, "--ignore-scripts", "--no-audit", "--no-fund", "--registry", "https://registry.npmjs.org"]);
        const lock = parse(readStableFile(join(prefix, "package-lock.json"), { label: "Verification install lock", maxBytes: 8 * 1024 * 1024 }).bytes);
        if (lock.packages?.["node_modules/@cairnkeep/cli"]?.integrity !== `sha512-${createHash("sha512").update(tarball).digest("base64")}`) {
          throw new Error("Release verification failed: audited package/candidate binding.");
        }
        const audited = run(npm, ["audit", "signatures", "--prefix", prefix, "--registry", "https://registry.npmjs.org"]);
        return /[1-9][0-9]* packages have verified registry signatures/.test(audited)
          && /[1-9][0-9]* packages have verified attestations/.test(audited);
      },
      oci: async (image, kind, ref) => {
        if (!tokens.has(image)) {
          const result = parse(await bytesFrom(`https://ghcr.io/token?service=ghcr.io&scope=repository:${image}:pull`, 64 * 1024));
          if (typeof result.token !== "string" || !result.token) throw new Error("Release verification failed: anonymous OCI access.");
          tokens.set(image, result.token);
        }
        const bytes = await bytesFrom(`https://ghcr.io/v2/${image}/${kind}/${ref}`, 16 * 1024 * 1024, {
          Authorization: `Bearer ${tokens.get(image)}`,
          Accept: "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json",
        }, kind === "blobs");
        return { digest: digest(bytes), value: parse(bytes) };
      },
      verifyAttestation: async (image, imageDigest) => {
        const verified = JSON.parse(ghRun(releaseAttestationArguments(image, imageDigest, expected)));
        return Array.isArray(verified) && verified.length > 0;
      },
    };
    const report = await verifyPublishedRelease(expected, io);
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify(report));
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const previousMask = process.umask(0o077);
  try { await main(process.argv.slice(2)); }
  catch (error) {
    console.error(error.message === usage || error.message?.startsWith("Release verification failed:")
      ? error.message : "Release verification failed; no verified report was written.");
    process.exitCode = 1;
  } finally { process.umask(previousMask); }
}
