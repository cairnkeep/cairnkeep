# Domain retrieval data-flow review

The `js/file-access-to-http` findings in `domain-retrieval-provider.ts` trace
the default workspace from the local memory configuration through
`domain_knowledge_query` to the configured provider. The source is the
`anythingllm_workspaces` field, not arbitrary document contents or stored memory.

This is an intentional disclosure boundary, not evidence of no disclosure:
the configured workspace identifier and the selected query leave the process.
Only configure a provider trusted to receive both. A read-only MCP annotation
means the tool does not mutate Cairnkeep state; it does **not** mean no network
traffic. The tool's open-world annotation reflects this boundary.

## Boundaries checked

- Provider origin and authentication come from operator environment settings,
  not workspace values or unrelated keys in a memory configuration file.
- The default provider percent-encodes the workspace as one path segment. A
  workspace that resembles a URL cannot select another origin or add headers.
- The optional resource provider uses its fixed read-only endpoint, scopes
  target identifiers below resources and rejects decoded traversal segments.
  It requires explicit feature consent and separate remote-HTTP consent.
- Neither request path reads, enumerates or uploads local documents. The
  query tool is separate from explicitly approved document synchronization.
- Both providers refuse redirects, bound responses and sanitize failures.
  Do not weaken these controls to make a static-analysis finding disappear.

`smoke-provider-config-flow.mjs` exercises the actual stdio MCP configuration
path for both providers, including a URL-shaped workspace, unrelated file
sentinels and forged endpoint/credential fields. It asserts the exact selected
request body, fixed mock origin and operator-supplied authentication. All
fixtures are synthetic and run against loopback only. Existing outbound tests
cover redirect denial, consent, response bounds and payload-free failures.

## Review disposition and limits

The reviewed flows are expected provider-routing disclosures, not a discovered
arbitrary-file-upload or file-selected-origin vulnerability. The alerts are
not dismissed or suppressed by this change: retain the finding and this
rationale for review, and reassess when source fields, destination selection,
workspace handling or provider behavior changes.

This is not a sandbox or a provider-side workspace ACL. A trusted local caller
can explicitly choose another workspace served by its provider credential;
the existing shared-token HTTP service is one trusted storage domain. Team
authorization remains separate, and team retrieval does not use these providers.
Same-account processes can change operator configuration. Tests establish the
documented application boundary, not the trustworthiness of a configured host.
