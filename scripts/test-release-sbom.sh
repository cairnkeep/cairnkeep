#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
CANDIDATE_WORKFLOW="$ROOT/.github/workflows/ci.yml"
PUBLISH_WORKFLOW="$ROOT/.github/workflows/publish.yml"
TEMP_DIR=$(mktemp -d)
trap 'rm -f "$TEMP_DIR/cairnkeep.cdx.json"; rmdir "$TEMP_DIR"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

node - "$ROOT/package.json" "$ROOT/package-lock.json" "$CANDIDATE_WORKFLOW" "$PUBLISH_WORKFLOW" <<'NODE'
const fs = require("node:fs");

const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const lock = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const candidateWorkflow = fs.readFileSync(process.argv[4], "utf8");
const publishWorkflow = fs.readFileSync(process.argv[5], "utf8");
const expected = "6.0.0";

if (manifest.devDependencies?.["@cyclonedx/cyclonedx-npm"] !== expected) {
  throw new Error(`package.json must pin @cyclonedx/cyclonedx-npm exactly to ${expected}`);
}
if (lock.packages?.[""]?.devDependencies?.["@cyclonedx/cyclonedx-npm"] !== expected) {
  throw new Error(`package-lock.json root must pin @cyclonedx/cyclonedx-npm exactly to ${expected}`);
}
if (lock.packages?.["node_modules/@cyclonedx/cyclonedx-npm"]?.version !== expected) {
  throw new Error(`package-lock.json must resolve @cyclonedx/cyclonedx-npm ${expected}`);
}

if (!candidateWorkflow.includes("release-candidate:")
  || !candidateWorkflow.includes("- name: Build release candidate")
  || !candidateWorkflow.includes("name: release-candidate-${{ steps.candidate.outputs.tree }}")) {
  throw new Error("CI must build and upload a tree-addressed release candidate after its required jobs");
}
if (!publishWorkflow.includes("- name: Download the CI-verified release candidate")
  || !publishWorkflow.includes("jq -r '.conclusion'")
  || !publishWorkflow.includes("== success")
  || !publishWorkflow.includes("sha256sum --check SHA256SUMS")
  || !publishWorkflow.includes("candidate.tree !== tree")) {
  throw new Error("release publication must verify the successful CI run, checksums, version, and exact tree");
}
const publishStep = publishWorkflow.indexOf("- name: Publish to npm with provenance");
const attachStep = publishWorkflow.indexOf("- name: Attach package and SBOM to GitHub release");
if (publishStep < 0 || attachStep < 0 || publishStep >= attachStep) {
  throw new Error("verified artifacts must publish to npm before release attachment");
}
if (!publishWorkflow.includes('npm publish "./artifacts/cairnkeep-cli-$VERSION.tgz"')) {
  throw new Error("npm publication must use an explicit relative tarball path");
}
if (!publishWorkflow.includes('gh release upload "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY"')) {
  throw new Error("release attachment must name the repository outside a checkout");
}
if (publishWorkflow.includes("check:public")) {
  throw new Error("release workflow must promote the verified candidate without repeating the public suite");
}
if (!publishWorkflow.includes("name: containers (${{ matrix.target }})")
  || !publishWorkflow.includes("- target: server")
  || !publishWorkflow.includes("- target: workspace")
  || !publishWorkflow.includes("needs: prepare")) {
  throw new Error("npm and both container targets must fan out after candidate preparation");
}
NODE

grep -Fq './node_modules/.bin/cyclonedx-npm' "$CANDIDATE_WORKFLOW" || fail "candidate workflow does not use the locked CycloneDX generator"
grep -Fq -- '--package-lock-only' "$CANDIDATE_WORKFLOW" || fail "candidate workflow does not use the package lock"
grep -Fq -- '--omit dev' "$CANDIDATE_WORKFLOW" || fail "candidate workflow does not omit development dependencies"
grep -Fq -- '--output-reproducible' "$CANDIDATE_WORKFLOW" || fail "candidate workflow does not request reproducible output"
grep -Fq -- '--spec-version 1.6' "$CANDIDATE_WORKFLOW" || fail "candidate workflow does not emit CycloneDX 1.6"
grep -Fq -- '--validate' "$CANDIDATE_WORKFLOW" || fail "candidate workflow does not validate the generated SBOM"
if grep -Fq 'npm sbom' "$CANDIDATE_WORKFLOW" "$PUBLISH_WORKFLOW"; then
  fail "release workflow still uses npm sbom"
fi
if grep -Fqi 'sbomsmith' "$CANDIDATE_WORKFLOW" "$PUBLISH_WORKFLOW"; then
  fail "release workflow must not depend on an external converter"
fi

"$ROOT/node_modules/.bin/cyclonedx-npm" \
  --package-lock-only \
  --omit dev \
  --output-reproducible \
  --spec-version 1.6 \
  --output-format JSON \
  --output-file "$TEMP_DIR/cairnkeep.cdx.json" \
  --validate \
  "$ROOT/package.json"

node - "$TEMP_DIR/cairnkeep.cdx.json" <<'NODE'
const fs = require("node:fs");

const bom = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (bom.bomFormat !== "CycloneDX") throw new Error("release SBOM format is not CycloneDX");
if (bom.specVersion !== "1.6") throw new Error("release SBOM version is not CycloneDX 1.6");
if (!Array.isArray(bom.components) || bom.components.length === 0) throw new Error("release SBOM has no components");
if (!Array.isArray(bom.dependencies) || bom.dependencies.length === 0) throw new Error("release SBOM has no dependency graph");

const scpLike = /^[^/@\s:]+@[^/\s:]+:.+$/;
function inspect(value) {
  if (Array.isArray(value)) {
    for (const item of value) inspect(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value.externalReferences)) {
    for (const reference of value.externalReferences) {
      if (typeof reference?.url === "string" && scpLike.test(reference.url)) {
        throw new Error(`release SBOM contains an invalid SCP-style external reference: ${reference.url}`);
      }
    }
  }
  for (const child of Object.values(value)) inspect(child);
}
inspect(bom);
NODE

echo "PASS: release SBOM is reproducible, schema-validated CycloneDX 1.6"
