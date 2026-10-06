# V28 - Security evidence you can inspect

Target length: 10–12 minutes. Audience: experienced developers operating an
agent-memory service locally or behind authenticated HTTP.

## Recording outline

### 0:00–1:20 — Threat model before tooling

Animate five boundaries: project storage, MCP authority, remote transport,
retrieved content, and release supply chain. State that Cairnkeep is not a
sandbox, secret manager, TLS terminator, or multi-user ACL.

### 1:20–3:20 — Safe local baseline

Type at human speed in a disposable directory:

```sh
lab=$(mktemp -d)
mkdir -p "$lab/.ai"
chmod 700 "$lab/.ai"
cairn security doctor --project "$lab"
```

Pause on the skipped HTTP checks. Explain that disabled network exposure is the
expected secure default, not a missing test.

### 3:20–5:30 — Make one failure visible

Run the weak synthetic-token example from L28. Zoom into the non-zero exit and
the `http-token` failure, then search the JSON for the planted value to show it
was not emitted. Leave a two-second pause before remediation.

### 5:30–7:20 — Reduce authority

Re-run with a long synthetic token, loopback host, and
`CAIRN_MCP_TOOL_PROFILE=read-only`. Put the tool-catalog intersection on screen:

```text
feature gates ∩ capabilities ∩ MCP profile = exposed tools
```

Stress that a profile removes authority; it never enables a feature.

### 7:20–9:20 — Show repository evidence

Use a split terminal for:

```sh
npm run security:baseline
npm --prefix mcp-memory-server run check:security-assurance
npm --prefix mcp-memory-server run check:http-guard
```

Highlight full-SHA action pins, CodeQL, dependency review, token non-leakage,
portable Windows/POSIX path cases, and the HTTP 413 test. Do not show repository
secrets or live security-alert details.

### 9:20–10:30 — Read the residual risks

End on `docs/security-assurance.md`, not on a green checkmark. Call out the
same-account trust boundary, lack of per-user HTTP ACLs, unencrypted local
databases, and prompt-injection residual risk. The closing message is: evidence
narrows uncertainty; it does not abolish trust.

## Recording cautions

- Use only a temporary project and synthetic token.
- Keep commands, exit codes, and report states legible; cut dead time rather
  than speeding narration.
- Do not imply that Scorecard, CodeQL, an SBOM, or provenance is a certification.
- Delete the exact temporary directory on screen at the end.
