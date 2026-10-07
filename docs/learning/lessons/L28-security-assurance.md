# L28 - Verify Cairnkeep's security posture

**Status:** Ready
**Tested with:** Cairnkeep 2.21.1 and Node.js 22 or newer

## Outcome

You will distinguish repository assurance from local deployment posture, run a
read-only security diagnostic, deliberately reproduce a weak-token failure,
and choose least authority for a network-facing MCP client.

## Prerequisites

- Install Cairnkeep 2.21.1 or use a disposable source checkout.
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
```

The baseline rejects unpinned external Actions and `pull_request_target`. The
smoke tests cover token non-disclosure, request bounds, and deterministic
portable-path adversarial cases.

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
