# L28 - Verify Cairnkeep's security posture

**Status:** Ready
**Tested with:** Cairnkeep 2.22.5 and Node.js 22 or newer

## Outcome

You will distinguish repository assurance from local deployment posture, run a
read-only security diagnostic, deliberately reproduce a weak-token failure,
and choose least authority for a network-facing MCP client.

## Prerequisites

- Install Cairnkeep 2.22.5 or use a disposable source checkout.
- Complete [L20 - Least-authority MCP tool profiles](L20-mcp-tool-profiles.md).
- Use synthetic values only; never paste a real bearer token into a recording,
  terminal transcript, or issue.

## Exercise

Create a disposable project and inspect the local-only posture:

```sh
lab=$(mktemp -d)
mkdir -p "$lab/.ai"
chmod 700 "$lab/.ai"
cairn security doctor --project "$lab"
cairn security doctor --project "$lab" --json
```

With HTTP disabled, the transport checks are `SKIP`. That is not missing
coverage: local stdio is the closed-by-default path.

Now model an unsafe deployment with a deliberately weak synthetic token:

```sh
MCP_HTTP_PORT=7801 \
CAIRN_MEMORY_HTTP_TOKEN=short \
cairn security doctor --project "$lab" --json
```

The command exits non-zero and reports `http-token` as `FAIL`. Confirm that the
JSON does not contain `short`. Then model a bounded observation-only endpoint:

```sh
MCP_HTTP_PORT=7801 \
MCP_HTTP_HOST=127.0.0.1 \
CAIRN_MEMORY_HTTP_TOKEN=synthetic-0123456789abcdef-0123456789abcdef \
CAIRN_MCP_TOOL_PROFILE=read-only \
cairn security doctor --project "$lab"
```

The diagnostic passes. This does not start the server, modify the project, or
prove that a reverse proxy supplies TLS; it checks only the effective local
configuration visible to this process.

Read [Security assurance and threat model](../../security-assurance.md), then
map each control to one boundary: project storage, MCP authority, remote
transport, context content, or release supply chain.

## Verification

From a source checkout, run the maintained offline gates:

```sh
npm run security:baseline
scripts/test-security-baseline.sh
npm --prefix mcp-memory-server run check:security-assurance
npm --prefix mcp-memory-server run check:http-guard
node mcp-memory-server/scripts/smoke-context-pack-state.mjs
node mcp-memory-server/scripts/smoke-note-signatures.mjs
node mcp-memory-server/scripts/smoke-runtime-file-reads.mjs
node mcp-memory-server/scripts/smoke-bounded-input-reads.mjs
node mcp-memory-server/scripts/smoke-workspace-file-security.mjs
node mcp-memory-server/scripts/smoke-outbound-security.mjs
node scripts/test-runtime-file-security.mjs
node scripts/test-omp-staged-security.mjs
node scripts/test-container-health.mjs
node mcp-memory-server/scripts/smoke-note-mcp.mjs --fixture-security-only
node scripts/verify-phase19-runtime-evidence.mjs --self-test
```

The baseline rejects unpinned external Actions, `pull_request_target` and
workflow-wide write permissions. It also checks the exact preparation/npm/OCI
job permission maps, including missing provenance grants and unnecessary write
authority. Inspect `.github/workflows/publish.yml` and compare its maps with
[Releasing](../../releasing.md): preparation must not inherit publishing or
signing authority. Unspecified entries in an explicit job map are denied.

These are static contract checks, not a live publication test. The npm secret
is a separate credential, and steps within one job share its token authority.
Do not republish an immutable version to demonstrate the test.

For post-publication evidence, run `node scripts/test-release-verification.mjs`
and read [Repeatable post-publication verification](../../releasing.md#repeatable-post-publication-verification).
The offline mutations reject mismatched trees/assets and failed signature or
provenance decisions; they do not validate real signatures. The explicit live
verifier checks the published artifacts with npm and the GitHub CLI and writes
a new report only after success. Its report says `deployment_verified: false`:
server backups, canaries and project doctors remain separate rollout evidence.
Never publish or upgrade a service just to record this exercise.

The smoke tests cover token non-disclosure, request bounds, and deterministic
portable-path adversarial cases.

The pack-state control deterministically substitutes a second valid pointer
after metadata inspection. The descriptor-bound reader rejects it, including
fabricated approvals; growth, unsafe types and non-private state are rejected
under bounded reads. A resolved review thread or green CodeQL job does not mean
all historical alerts are fixed: inspect current findings and test the actual
boundary without dismissing results merely to improve an advisory score.

In a checkout containing the runtime-security follow-up, the signature control
keeps existing v1 fingerprints byte-equivalent and isolates crafted path inputs
behind a five-second child-process timeout. The runtime file-read control
substitutes valid capability configuration, skill targets/ledgers/backups and
work-evidence records after inspection. Readers reject those replacements,
bound growth, reject special files without waiting for a writer and close their
descriptors. Ordinary project configuration may remain `0644`; private evidence
and approval ledgers still require private ownership/ACLs. Build the server
before running source-checkout controls. The generated parser corpus is
reproducible regression coverage, not integrated coverage-guided fuzzing.

The bounded-input follow-up extends descriptor-bound reads to evaluation,
OKF import/export, graph artifacts, private playbook receipts and derived
progressive-context caches. Compare a replaced valid file with same-inode
growth: rejecting oversized content after `readFile` has allocated it is not
a bounded read. Note snapshots publish the bytes that were inspected and
hashed, not a later reopened file. Unsafe derived caches can be rebuilt from
immutable content; read-only doctor reports them without deletion. Cache
rebuilding never changes project enablement or skill approval. This exercise
does not certify directory-wide transactions against other same-account
processes.

The publication follow-up extends the exercise to setup, instruction files,
evaluation overlays and native Windows managed writes. Inspect a concurrent
caller edit: rechecking the observed target before publication must preserve
it. A denied Windows replacement must retain the live database, not unlink it
to retry. A substituted overlay symlink must leave its outside sentinel intact.
Exclusive descriptor-written temporaries retain modes and clean only their own
files. These are point-in-time safeguards, not all-project transactions or
protection against another hostile process using your account. Native Windows
and container/package verification remain required before shipping.

The OMP control reads only synthetic staged candidates, never invokes a model,
and shows that linked, growing or over-8-KiB content cannot become wakeup
evidence or `/cairn-staged` output. It does not approve or persist a candidate.
The outbound and health controls stub network calls: provider redirects and
oversized bodies fail, private error sentinels never appear in diagnostics,
and a malformed health port never becomes a network destination. Successful
retrieval still sends a query to the explicitly configured external provider.
AnythingLLM responses have an 8 MiB cap; OpenViking retains its 1 MiB cap and
separate consent gates. Prefer HTTPS outside loopback.

In a checkout with the developer-evidence follow-up, the focused note control
shows that exclusive fixture creation preserves a competing file and that the
actual note transaction rejects a substituted pre-image. Hashing is bounded
at 64 MiB, including same-inode growth checks. The runtime-evidence self-test
rejects changed or replaced log files under its existing 16 MiB cap. Developer
snapshots and corrupt-database controls still compare exact bytes; static log
labels cannot turn provider text into forged passing results. This does not
make multi-file note publication atomic or prove an empty analysis backlog.

## Common failures

- A private `.ai` file is group/world accessible on POSIX: restore mode `0600`.
- HTTP is non-loopback without an explicit Host allowlist: set the public host
  names and ports intentionally.
- A network client receives the `full` profile although it only observes:
  choose `read-only` or a reviewed `custom` allowlist and restart the server.
- A remote URL uses plaintext HTTP: use HTTPS, unless it is an intentional
  loopback-only hop.

## Privacy and trust boundary

The diagnostic reads configuration, file metadata, and only the length and
simple repetition of a configured token. It writes nothing and performs no
network request, but JSON includes the canonical project path. A passing report
is point-in-time evidence, not a certification or a substitute for TLS, host
hardening, secret management, or multi-user authorization.

## Recovery

Remove the disposable directory after inspecting the output:

```sh
rm -rf -- "$lab"
```

For a real project, correct only the named file or environment setting. Do not
delete durable memory or regenerate credentials merely to silence a warning;
first decide whether the reported exposure is intentional.
