import { createHash } from "node:crypto";

function requireThat(condition, label) { if (!condition) throw new Error(`Release verification failed: ${label}.`); }
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const digestPattern = /^sha256:[a-f0-9]{64}$/;

export function validateReleaseOptions(options) {
  requireThat(/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(options.repo ?? ""), "repository");
  requireThat(/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(options.version ?? ""), "stable version");
  for (const field of ["commit", "tree"]) requireThat(/^[a-f0-9]{40}$/.test(options[field] ?? ""), `exact ${field}`);
  for (const field of ["ciRun", "securityRun", "publishRun"]) requireThat(/^[1-9][0-9]*$/.test(options[field] ?? ""), field);
}

export function releaseAttestationArguments(image, digest, options) {
  validateReleaseOptions(options);
  requireThat(digestPattern.test(digest), "attestation subject digest");
  requireThat(image === options.repo || image === `${options.repo}-workspace`, "attestation image repository");
  // Exact certificate identity binds repository, workflow and tag. The CLI
  // makes this mutually exclusive with its broader signer-workflow selector.
  return ["attestation", "verify", `oci://ghcr.io/${image}@${digest}`, "--repo", options.repo,
    "--source-ref", `refs/tags/v${options.version}`, "--source-digest", options.commit,
    "--cert-identity", `https://github.com/${options.repo}/.github/workflows/publish.yml@refs/tags/v${options.version}`,
    "--cert-oidc-issuer", "https://token.actions.githubusercontent.com",
    "--predicate-type", "https://slsa.dev/provenance/v1", "--deny-self-hosted-runners", "--format", "json"];
}

function json(bytes, label) {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error(`Release verification failed: ${label} encoding or JSON.`); }
}

function verifyAssets(options, candidate, released) {
  const names = [`cairnkeep-cli-${options.version}.tgz`, `cairnkeep-cli-${options.version}.cdx.json`];
  const exactKeys = (map, expected) => map instanceof Map && JSON.stringify([...map.keys()].sort()) === JSON.stringify(expected.sort());
  requireThat(exactKeys(candidate, [...names, "SHA256SUMS", "RELEASE-CANDIDATE.json"]), "candidate file set");
  requireThat(exactKeys(released, [...names, "SHA256SUMS"]), "release asset set");
  const manifest = json(candidate.get("RELEASE-CANDIDATE.json"), "candidate manifest");
  requireThat(Object.keys(manifest).sort().join(",") === "schema_version,tree,version"
    && manifest.schema_version === 1 && manifest.tree === options.tree && manifest.version === options.version, "candidate manifest binding");
  const sums = new TextDecoder("utf-8", { fatal: true }).decode(candidate.get("SHA256SUMS")).trim().split("\n");
  requireThat(sums.length === names.length, "checksum file count");
  const seen = new Set();
  for (const line of sums) {
    const match = /^([a-f0-9]{64})\s+\*?(?:\.\/)?([A-Za-z0-9._-]+)$/.exec(line);
    requireThat(match && names.includes(match[2]) && !seen.has(match[2]), "checksum paths and uniqueness");
    seen.add(match[2]);
    requireThat(hash(candidate.get(match[2])) === match[1], "candidate checksum");
    requireThat(candidate.get(match[2]).equals(released.get(match[2])), "release/candidate exact bytes");
  }
  requireThat(candidate.get("SHA256SUMS").equals(released.get("SHA256SUMS")), "checksum asset exact bytes");
  const sbom = json(candidate.get(names[1]), "SBOM");
  requireThat(sbom.bomFormat === "CycloneDX" && sbom.specVersion === "1.6"
    && sbom.metadata?.component?.version === options.version, "CycloneDX release binding");
  return candidate.get(names[0]);
}

export async function verifyPublishedRelease(options, io) {
  validateReleaseOptions(options);
  const api = path => io.api(path);
  const ci = await api(`actions/runs/${options.ciRun}`);
  requireThat(ci.conclusion === "success" && ci.path === ".github/workflows/ci.yml", "successful maintained CI");
  requireThat((await api(`git/commits/${ci.head_sha}`)).tree?.sha === options.tree, "tested tree");
  requireThat((await api(`git/commits/${options.commit}`)).tree?.sha === options.tree, "release tree");
  const security = await api(`actions/runs/${options.securityRun}`);
  requireThat(security.conclusion === "success" && security.path === ".github/workflows/security.yml", "successful maintained security workflow");
  requireThat((await api(`git/commits/${security.head_sha}`)).tree?.sha === options.tree, "security-tested tree");
  let tag = (await api(`git/ref/tags/v${options.version}`)).object;
  for (let depth = 0; tag?.type === "tag" && depth < 4; depth++) tag = (await api(`git/tags/${tag.sha}`)).object;
  requireThat(tag?.type === "commit" && tag.sha === options.commit, "immutable tag source");
  const publication = await api(`actions/runs/${options.publishRun}`);
  requireThat(publication.conclusion === "success" && publication.path === ".github/workflows/publish.yml"
    && publication.event === "release" && publication.head_sha === options.commit, "successful exact-source publication");
  const release = await api(`releases/tags/v${options.version}`);
  requireThat(release.tag_name === `v${options.version}` && release.draft === false && release.prerelease === false, "published stable release");
  const artifacts = (await api(`actions/runs/${options.ciRun}/artifacts?per_page=100`)).artifacts;
  const matches = artifacts?.filter(a => a.name === `release-candidate-${options.tree}` && a.expired === false);
  requireThat(matches?.length === 1, "one retained exact-tree candidate");
  const tarball = verifyAssets(options, await io.candidate(matches[0]), await io.release());
  const registry = await io.registry();
  let url;
  try { url = new URL(registry.dist?.tarball); } catch { /* fail below */ }
  requireThat(registry.version === options.version && url?.protocol === "https:" && url.hostname === "registry.npmjs.org"
    && !url.username && !url.password && !url.port && !url.hash, "registry tarball authority");
  const publishedTarball = await io.tarball(url.href);
  requireThat(tarball.equals(publishedTarball), "registry/candidate exact bytes");
  requireThat(registry.dist.integrity === `sha512-${createHash("sha512").update(tarball).digest("base64")}`, "registry integrity");
  requireThat(await io.verifyNpm(tarball), "npm signatures and attestations");

  const images = [];
  const [owner, project] = options.repo.split("/");
  for (const name of [project, `${project}-workspace`]) {
    const image = `${owner}/${name}`;
    const get = async (kind, ref) => {
      requireThat([options.version, "latest"].includes(ref) || digestPattern.test(ref), "OCI reference");
      const result = await io.oci(image, kind, ref);
      requireThat(digestPattern.test(result.digest) && (!ref.startsWith("sha256:") || result.digest === ref), "OCI content digest");
      return result;
    };
    const index = await get("manifests", options.version);
    requireThat((await get("manifests", "latest")).digest === index.digest, "stable image channel");
    const manifests = index.value.manifests;
    requireThat(Array.isArray(manifests) && manifests.length <= 32, "bounded OCI index");
    for (const arch of ["amd64", "arm64"]) {
      const entries = manifests.filter(m => m.platform?.os === "linux" && m.platform?.architecture === arch);
      requireThat(entries.length === 1, "one image per supported architecture");
      const entry = entries[0];
      const manifest = (await get("manifests", entry.digest)).value;
      const config = (await get("blobs", manifest.config?.digest)).value;
      requireThat(config.os === "linux" && config.architecture === arch
        && config.config?.Labels?.["org.opencontainers.image.revision"] === options.commit, "image platform/source binding");
      const attestations = manifests.filter(m => m.annotations?.["vnd.docker.reference.digest"] === entry.digest
        && m.annotations?.["vnd.docker.reference.type"] === "attestation-manifest");
      requireThat(attestations.length === 1, "bound build attestation");
      const layers = (await get("manifests", attestations[0].digest)).value.layers;
      requireThat(Array.isArray(layers) && layers.length <= 32, "bounded attestation layers");
      let sbom = false;
      for (const layer of layers) {
        const statement = (await get("blobs", layer.digest)).value;
        if (statement.predicateType === "https://spdx.dev/Document" && statement.predicate?.spdxVersion?.startsWith("SPDX-")
          && statement.subject?.some(s => s.digest?.sha256 === entry.digest.slice(7))) sbom = true;
      }
      requireThat(sbom, "per-architecture bound SPDX SBOM");
    }
    requireThat(await io.verifyAttestation(image, index.digest, options), "verified exact-source release-workflow provenance");
    images.push({ image: `ghcr.io/${image}`, digest: index.digest, platforms: ["linux/amd64", "linux/arm64"] });
  }
  return { schema_version: 1, status: "verified", ...options, candidate_artifact: matches[0].id,
    exact_bytes: true, cyclonedx: "1.6", npm_signatures_and_attestations: true, images,
    scope: "release-artifacts-only", anonymous_oci_metadata_verified: true,
    full_image_layer_pull_verified: false, deployment_verified: false };
}
